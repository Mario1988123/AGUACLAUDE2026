"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { generateToolSecret, hashToolSecret, loadVoiceSettings } from "./settings";
import type { VoiceSettings } from "./settings";

const settingsSchema = z.object({
  service_enabled: z.boolean(),
  commercial_enabled: z.boolean(),
  provider: z.enum(["elevenlabs", "twilio", "retell", "vapi"]),
  agent_id_service: z.string().trim().max(200).nullable(),
  agent_id_commercial: z.string().trim().max(200).nullable(),
  caller_id_service: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Formato internacional: +34911234567")
    .nullable(),
  caller_id_commercial: z
    .string()
    .trim()
    .regex(/^\+34400\d{6}$/, "El número comercial debe ser del rango 400: +34400XXXXXX")
    .nullable(),
  service_window_start: z.number().int().min(0).max(23),
  service_window_end: z.number().int().min(1).max(24),
  commercial_window_start: z.number().int().min(9).max(20),
  commercial_window_end: z.number().int().min(10).max(21),
  max_attempts: z.number().int().min(1).max(5),
  retry_hours: z.number().int().min(1).max(168),
  monthly_minutes_cap: z.number().int().min(0).max(100_000),
  max_call_seconds: z.number().int().min(30).max(900),
  escalation_phone: z.string().trim().max(30).nullable(),
  record_audio: z.boolean(),
  transcript_retention_days: z.number().int().min(7).max(365),
  company_pitch: z.string().trim().max(4000).nullable(),
  forbidden_topics: z.string().trim().max(4000).nullable(),
  // --- recepcionista entrante ---
  inbound_enabled: z.boolean(),
  agent_id_inbound: z.string().trim().max(200).nullable(),
  inbound_can_book: z.boolean(),
  inbound_can_open_incident: z.boolean(),
  transfer_enabled: z.boolean(),
  // --- cierre por WhatsApp ---
  whatsapp_confirm_enabled: z.boolean(),
  whatsapp_sender: z
    .string()
    .trim()
    .regex(
      /^(whatsapp:)?\+[1-9]\d{7,14}$/,
      "Formato: +34612345678 (o whatsapp:+34612345678)",
    )
    .nullable(),
});

export type VoiceSettingsInput = z.infer<typeof settingsSchema>;

function requireAdmin(roles: string[], isSuper: boolean): void {
  if (!isSuper && !roles.includes("company_admin")) {
    throw new Error("Solo el administrador de la empresa puede tocar esta configuración.");
  }
}

export async function getVoiceSettingsAction(): Promise<VoiceSettings | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  return loadVoiceSettings(session.company_id);
}

export async function saveVoiceSettingsAction(
  input: VoiceSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    requireAdmin(session.roles, session.is_superadmin);

    const parsed = settingsSchema.parse(input);

    // Lo que la BD también comprueba, comprobado aquí para dar un mensaje
    // entendible en vez de un error de constraint. La BD sigue siendo la que
    // manda: esto es cortesía, no la defensa.
    if (parsed.service_window_end <= parsed.service_window_start) {
      return { ok: false, error: "La ventana de servicio termina antes de empezar." };
    }
    if (parsed.commercial_window_end <= parsed.commercial_window_start) {
      return { ok: false, error: "La ventana comercial termina antes de empezar." };
    }
    if (parsed.caller_id_service && /^\+?34?400/.test(parsed.caller_id_service)) {
      return {
        ok: false,
        error:
          "El rango 400 está reservado a llamadas comerciales y no puede usarse para atención al cliente. Pon el número geográfico o el 900 de la empresa.",
      };
    }
    if (parsed.commercial_enabled && !parsed.caller_id_commercial) {
      return {
        ok: false,
        error:
          "Para activar la captación comercial hace falta un número del rango 400. Se pide al operador de telefonía; la CNMC lo asigna a operadores registrados.",
      };
    }
    if (parsed.inbound_enabled && !parsed.agent_id_inbound) {
      return {
        ok: false,
        error:
          "Para activar la recepcionista hace falta el identificador de su agente en la plataforma de voz.",
      };
    }
    // Prometer una transferencia que no se puede hacer es peor que no
    // ofrecerla: el cliente espera en la línea y se le cuelga.
    if (parsed.transfer_enabled && !parsed.escalation_phone) {
      return {
        ok: false,
        error:
          "Para transferir llamadas hace falta un móvil de guardia al que pasarlas.",
      };
    }
    if (parsed.whatsapp_confirm_enabled && !parsed.whatsapp_sender) {
      return {
        ok: false,
        error:
          "Para mandar la confirmación por WhatsApp hace falta el número WhatsApp Business de esta empresa. Sin él se usaría un número compartido con otras empresas y las respuestas del cliente no se podrían enrutar.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("voice_agent_settings").upsert(
      { company_id: session.company_id, ...parsed },
      { onConflict: "company_id" },
    );
    if (error) throw error;

    revalidatePath("/agente-voz");
    revalidatePath("/configuracion/agente-voz");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "saveVoiceSettingsAction") };
  }
}

/**
 * Genera el secreto que la plataforma de voz presenta en cada llamada a
 * /api/voice-agent/tools/*. Se devuelve UNA vez y solo se guarda su hash: si
 * el usuario lo pierde, se genera otro. No hay forma de recuperarlo, y es
 * justo lo que se quiere de un secreto.
 */
export async function rotateToolSecretAction(): Promise<{
  ok: boolean;
  secret?: string;
  error?: string;
}> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    requireAdmin(session.roles, session.is_superadmin);

    const secret = generateToolSecret();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("voice_agent_settings").upsert(
      {
        company_id: session.company_id,
        tool_secret_hash: hashToolSecret(secret),
        tool_secret_rotated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
    if (error) throw error;

    revalidatePath("/configuracion/agente-voz");
    return { ok: true, secret };
  } catch (e) {
    return { ok: false, error: toActionError(e, "rotateToolSecretAction") };
  }
}

/**
 * Devuelve el guion completo que se le manda al agente, para poder LEERLO
 * antes de encender nada. Un guion que nadie ha leído en voz alta es un guion
 * que va a decir algo raro a un cliente.
 */
export async function previewPromptAction(
  purpose: "service" | "commercial" | "inbound",
): Promise<{ ok: boolean; prompt?: string; first_message?: string; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    const settings = await loadVoiceSettings(session.company_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("companies")
      .select("name")
      .eq("id", session.company_id)
      .maybeSingle();
    const companyName = (data as { name: string | null } | null)?.name ?? "la empresa";

    const { buildPrompt, buildFirstMessage, buildInboundPrompt, buildInboundGreeting } =
      await import("./prompts");

    const canTransfer =
      settings.transfer_enabled && Boolean(settings.escalation_phone);

    if (purpose === "inbound") {
      return {
        ok: true,
        prompt: buildInboundPrompt({
          company_name: companyName,
          company_pitch: settings.company_pitch,
          forbidden_topics: settings.forbidden_topics,
          can_transfer: canTransfer,
          can_book: settings.inbound_can_book,
          can_open_incident: settings.inbound_can_open_incident,
          transfer_enabled: settings.transfer_enabled,
        }),
        first_message: buildInboundGreeting(companyName),
      };
    }

    return {
      ok: true,
      prompt: buildPrompt(purpose, {
        company_name: companyName,
        company_pitch: settings.company_pitch,
        forbidden_topics: settings.forbidden_topics,
        can_transfer: canTransfer,
      }),
      first_message: buildFirstMessage(purpose, companyName, "María"),
    };
  } catch (e) {
    return { ok: false, error: toActionError(e, "previewPromptAction") };
  }
}
