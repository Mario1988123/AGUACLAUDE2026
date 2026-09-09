import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { loadVoiceSettings } from "@/modules/voice-agent/settings";
import { evaluateInboundGate, toE164 } from "@/modules/voice-agent/guardrails";
import {
  buildInboundPrompt,
  buildInboundGreeting,
  inboundToolsFor,
} from "@/modules/voice-agent/prompts";
import { resolveCallerByPhone, logVoiceEvent } from "@/modules/voice-agent/lookup";
import { verifyVoiceSignature } from "@/modules/voice-agent/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * La recepcionista descuelga.
 *
 * La plataforma de voz llama aquí ANTES de contestar, para saber qué agente
 * poner y con qué contexto. Es el momento en el que se decide todo: de qué
 * empresa es la llamada, quién llama, y qué se le permite hacer al agente.
 *
 * Tiene que ser rápido. Cada milisegundo aquí es un tono de llamada más para
 * quien está esperando al otro lado, así que las consultas van en paralelo y
 * el presupuesto de tiempo es de un segundo largo, no de cinco.
 *
 * Una decisión que merece explicación: **cuando algo falla, no se cuelga**.
 * Un número sin dar de alta, la recepcionista apagada o el presupuesto agotado
 * devuelven `reject`, y la plataforma debe estar configurada para desviar la
 * llamada al teléfono de siempre. Colgarle a un cliente que llama a su
 * proveedor de agua es mucho peor que pagar el minuto.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifyVoiceSignature(req, raw)) {
    console.error("[voice-agent] webhook entrante con firma inválida");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // ElevenLabs manda `caller_id` y `called_number`; Twilio manda `From` y `To`.
  // Se aceptan los dos para no atarse a un proveedor.
  const calledRaw =
    (body.called_number as string | undefined) ??
    (body.agent_number as string | undefined) ??
    (body.To as string | undefined) ??
    null;
  const callerRaw =
    (body.caller_id as string | undefined) ??
    (body.from_number as string | undefined) ??
    (body.From as string | undefined) ??
    null;
  const providerCallId =
    (body.call_sid as string | undefined) ??
    (body.conversation_id as string | undefined) ??
    (body.CallSid as string | undefined) ??
    null;

  const called = toE164(calledRaw);
  if (!called) {
    return NextResponse.json({ error: "no_called_number" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // --- 1. ¿De qué empresa es este número? Es lo ÚNICO que lo identifica. ---
  const { data: companyId } = await admin.rpc("voice_company_for_inbound", {
    p_to_number: called,
  });
  const company = (companyId as string | null) ?? null;

  const settings = company ? await loadVoiceSettings(company) : null;
  const gate = evaluateInboundGate(
    {
      inbound_enabled: settings?.inbound_enabled ?? false,
      agent_id_inbound: settings?.agent_id_inbound ?? null,
      monthly_minutes_cap: settings?.monthly_minutes_cap ?? 0,
      minutes_used_month: settings?.minutes_used_month ?? 0,
    },
    Boolean(company && settings),
  );

  if (!gate.allowed) {
    console.warn(
      `[voice-agent] entrante rechazada en ${called}: ${gate.code} — ${gate.reason}`,
    );
    // `reject` con motivo: la plataforma desvía al número humano de la empresa.
    return NextResponse.json({
      reject: true,
      reason: gate.code,
      message: gate.reason,
    });
  }

  // A partir de aquí `company` y `settings` existen: el gate lo ha comprobado.
  const companyIdOk = company as string;
  const s = settings!;

  // --- 2. ¿Quién llama? ---
  const [caller, companyRow] = await Promise.all([
    resolveCallerByPhone(companyIdOk, callerRaw),
    admin.from("companies").select("name").eq("id", companyIdOk).maybeSingle(),
  ]);
  const companyName =
    ((companyRow as { data: { name: string | null } | null }).data?.name) ??
    "su instalador";

  // --- 3. Abrir el intento. Sirve de contexto para las herramientas y de
  //        prueba de que se declaró ser una IA. ---
  const { data: attemptRow } = await admin
    .from("voice_call_attempts")
    .insert({
      company_id: companyIdOk,
      task_id: null,
      direction: "inbound",
      // Una entrante es atención al cliente, y la atención al cliente es
      // servicio. Nunca es una llamada comercial: no la hemos hecho nosotros.
      purpose: "service",
      provider: s.provider,
      provider_call_id: providerCallId,
      from_number: called,
      to_phone_e164: caller.phone_e164 ?? callerRaw ?? "desconocido",
      customer_id: caller.kind === "customer" ? caller.id : null,
      lead_id: caller.kind === "lead" ? caller.id : null,
      // El saludo lleva la declaración incrustada y lo dice la plataforma
      // siempre, no el modelo cuando se acuerda.
      ai_disclosure_given: true,
      human_escalation_offered: true,
    })
    .select("id")
    .single();
  const attemptId = (attemptRow as { id: string } | null)?.id ?? null;

  void logVoiceEvent({
    companyId: companyIdOk,
    kind: "voice_agent.inbound_call",
    caller,
    payload: {
      called,
      caller_kind: caller.kind,
      provider_call_id: providerCallId,
      attempt_id: attemptId,
    },
  });

  // --- 4. El contexto que recibe el agente ---
  const prompt = buildInboundPrompt({
    company_name: companyName,
    company_pitch: s.company_pitch,
    forbidden_topics: s.forbidden_topics,
    can_transfer: Boolean(s.escalation_phone) && s.transfer_enabled,
    can_book: s.inbound_can_book,
    can_open_incident: s.inbound_can_open_incident,
    transfer_enabled: s.transfer_enabled,
  });

  // Lo que el agente sabe de quien llama. Va como variables, no dentro del
  // prompt: así se ve en la transcripción qué contexto tenía y no se puede
  // confundir con instrucciones.
  const vars: Record<string, string> = {
    hm_attempt_id: attemptId ?? "",
    company_name: companyName,
    caller_kind: caller.kind,
    caller_name: caller.display_name ?? "",
    caller_is_customer: caller.kind === "customer" ? "sí" : "no",
    caller_has_contract: caller.has_active_contract ? "sí" : "no",
  };

  return NextResponse.json({
    // Formato ElevenLabs. Twilio ConversationRelay ignora lo que no entiende.
    type: "conversation_initiation_client_data",
    dynamic_variables: vars,
    conversation_config_override: {
      agent: {
        prompt: { prompt },
        first_message: buildInboundGreeting(companyName),
        language: "es",
      },
      conversation: { max_duration_seconds: s.max_call_seconds },
    },
    // Informativo para el panel del proveedor: qué herramientas tiene permitidas
    // esta empresa. La lista real la impone `/api/voice-agent/tools`, que
    // rechaza lo que no toque aunque el agente lo intente.
    allowed_tools: inboundToolsFor({
      can_book: s.inbound_can_book,
      can_open_incident: s.inbound_can_open_incident,
    }),
  });
}
