import "server-only";
import type { CallPurpose } from "./guardrails";
import type { VoiceSettings } from "./settings";
import { buildFirstMessage, buildPrompt } from "./prompts";

/**
 * La capa de telefonía. Aquí y solo aquí se habla con el proveedor de voz.
 *
 * Todo lo que sabe hacer el agente vive en NUESTROS endpoints
 * (`/api/voice-agent/tools/*`). El proveedor pone el audio y nada más. Es lo
 * que permite cambiar de ElevenLabs a Twilio a lo que venga sin tocar una
 * línea de lógica de negocio — y lo que mantiene el `company_id` de nuestro
 * lado en vez de dentro del prompt de un tercero.
 *
 * Modo simulación: si no hay credenciales, `placeCall` devuelve ok con un id
 * `dry_…` y no marca a nadie. Sirve para probar la cola, los guardarraíles y
 * la UI enteras sin gastar un céntimo ni molestar a un cliente real. Es el
 * modo en el que hay que dejar el sistema el primer día.
 */

export interface PlaceCallInput {
  purpose: CallPurpose;
  settings: VoiceSettings;
  companyName: string;
  agentId: string;
  fromNumber: string;
  toPhoneE164: string;
  contactName: string | null;
  /**
   * Contexto que la plataforma inyecta en la conversación. NUNCA metas aquí
   * el company_id ni el secreto de herramientas: el agente podría repetirlos
   * en voz alta o filtrarlos en la transcripción. La identidad del tenant va
   * en la cabecera de las herramientas, no en el diálogo.
   */
  variables: Record<string, string>;
  /** Se devuelve tal cual en el webhook para casar la llamada con la tarea. */
  taskId: string;
  toolSecret: string;
}

export interface PlaceCallResult {
  ok: boolean;
  provider_call_id: string | null;
  error: string | null;
  simulated: boolean;
}

function isSimulation(settings: VoiceSettings): boolean {
  if (process.env.VOICE_AGENT_SIMULATE === "true") return true;
  if (settings.provider === "elevenlabs") return !process.env.ELEVENLABS_API_KEY;
  if (settings.provider === "twilio") {
    return !(process.env.VOICE_TWILIO_SID && process.env.VOICE_TWILIO_TOKEN);
  }
  return true;
}

export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  if (isSimulation(input.settings)) {
    console.info(
      `[voice-agent] SIMULACIÓN — no se marca. purpose=${input.purpose} ` +
        `from=${input.fromNumber} to=${input.toPhoneE164} task=${input.taskId}`,
    );
    return {
      ok: true,
      provider_call_id: `dry_${input.taskId}`,
      error: null,
      simulated: true,
    };
  }

  switch (input.settings.provider) {
    case "elevenlabs":
      return placeCallElevenLabs(input);
    case "twilio":
      return placeCallTwilio(input);
    default:
      return {
        ok: false,
        provider_call_id: null,
        error: `Proveedor "${input.settings.provider}" sin implementar`,
        simulated: false,
      };
  }
}

/**
 * ElevenLabs Agents — llamada saliente por su telefonía nativa.
 * Se le manda el prompt y el primer mensaje en cada llamada (override) en vez
 * de dejarlos fijos en su panel: así el guion vive en este repositorio, se
 * versiona con git y se puede auditar. Si estuviera en su panel, nadie sabría
 * quién lo cambió ni cuándo.
 */
async function placeCallElevenLabs(input: PlaceCallInput): Promise<PlaceCallResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    return {
      ok: false,
      provider_call_id: null,
      error: "Faltan ELEVENLABS_API_KEY o ELEVENLABS_PHONE_NUMBER_ID",
      simulated: false,
    };
  }

  const prompt = buildPrompt(input.purpose, {
    company_name: input.companyName,
    company_pitch: input.settings.company_pitch,
    forbidden_topics: input.settings.forbidden_topics,
    // Coherente con lo que hace `escalar_humano`: solo se promete transferir
    // si la empresa lo ha activado Y hay un número al que pasar la llamada.
    // Decir "le paso" y luego colgar es peor que no ofrecerlo.
    can_transfer:
      input.settings.transfer_enabled && Boolean(input.settings.escalation_phone),
  });

  const body = {
    agent_id: input.agentId,
    agent_phone_number_id: phoneNumberId,
    to_number: input.toPhoneE164,
    conversation_initiation_client_data: {
      dynamic_variables: {
        ...input.variables,
        // El id de tarea vuelve en el webhook: es la única forma fiable de
        // saber a qué llamada corresponde una transcripción.
        hm_task_id: input.taskId,
      },
      conversation_config_override: {
        agent: {
          prompt: { prompt },
          first_message: buildFirstMessage(
            input.purpose,
            input.companyName,
            input.contactName,
          ),
          language: "es",
        },
        conversation: { max_duration_seconds: input.settings.max_call_seconds },
      },
    },
  };

  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      conversation_id?: string;
      callSid?: string;
      detail?: unknown;
      message?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        provider_call_id: null,
        error:
          json.message ??
          (typeof json.detail === "string" ? json.detail : `HTTP ${res.status}`),
        simulated: false,
      };
    }
    return {
      ok: true,
      provider_call_id: json.conversation_id ?? json.callSid ?? null,
      error: null,
      simulated: false,
    };
  } catch (e) {
    return {
      ok: false,
      provider_call_id: null,
      error: e instanceof Error ? e.message : "Error de red con ElevenLabs",
      simulated: false,
    };
  }
}

/**
 * Twilio ConversationRelay — plan B. El proyecto ya tiene `twilio` instalado y
 * credenciales para WhatsApp, así que aquí solo hace falta un número de voz.
 * La ventaja real no es técnica: es una factura, un proveedor y un DPA menos.
 */
async function placeCallTwilio(input: PlaceCallInput): Promise<PlaceCallResult> {
  const sid = process.env.VOICE_TWILIO_SID;
  const token = process.env.VOICE_TWILIO_TOKEN;
  const relayUrl = process.env.VOICE_RELAY_WSS_URL;
  if (!sid || !token || !relayUrl) {
    return {
      ok: false,
      provider_call_id: null,
      error: "Faltan VOICE_TWILIO_SID / VOICE_TWILIO_TOKEN / VOICE_RELAY_WSS_URL",
      simulated: false,
    };
  }
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(sid, token);
    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect>` +
      `<ConversationRelay url="${relayUrl}?task=${encodeURIComponent(input.taskId)}" ` +
      `language="es-ES" ttsProvider="ElevenLabs" />` +
      `</Connect></Response>`;
    const call = await client.calls.create({
      from: input.fromNumber,
      to: input.toPhoneE164,
      twiml,
      timeLimit: input.settings.max_call_seconds,
    });
    return { ok: true, provider_call_id: call.sid, error: null, simulated: false };
  } catch (e) {
    return {
      ok: false,
      provider_call_id: null,
      error: e instanceof Error ? e.message : "Error Twilio",
      simulated: false,
    };
  }
}
