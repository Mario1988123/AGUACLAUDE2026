/**
 * Cliente WhatsApp via Twilio.
 *
 * En modo sandbox (gratis para test): el destinatario tiene que enviar
 * primero "join <palabra>" al número Twilio para autorizarse. Para
 * producción real hay que registrar el número WhatsApp Business y
 * crear plantillas aprobadas por Meta.
 *
 * Variables de entorno:
 *   WHATSAPP_TWILIO_SID      — Account SID (AC...)
 *   WHATSAPP_TWILIO_TOKEN    — Auth token
 *   WHATSAPP_TWILIO_FROM     — Sender (ej. "whatsapp:+14155238886" sandbox)
 */

import twilio from "twilio";

let _client: ReturnType<typeof twilio> | null = null;

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_TWILIO_SID &&
      process.env.WHATSAPP_TWILIO_TOKEN &&
      process.env.WHATSAPP_TWILIO_FROM,
  );
}

function getTwilio() {
  if (_client) return _client;
  if (!isWhatsAppConfigured()) {
    throw new Error(
      "WhatsApp no configurado. Faltan WHATSAPP_TWILIO_SID/TOKEN/FROM en variables de entorno.",
    );
  }
  _client = twilio(
    process.env.WHATSAPP_TWILIO_SID!,
    process.env.WHATSAPP_TWILIO_TOKEN!,
  );
  return _client;
}

/**
 * Envía un mensaje WhatsApp. El número del destinatario debe estar en
 * formato E.164 internacional (+34612345678).
 *
 * Para texto libre solo funciona si:
 *   · El destinatario te ha escrito en las últimas 24h, O
 *   · El número está en sandbox + autorizado.
 *
 * Para mensajes salientes en frío hay que usar `template_sid` con una
 * plantilla pre-aprobada por Meta (ej. "tu_pedido_listo").
 */
export interface SendWhatsAppInput {
  to_phone: string; // +34612345678
  body: string;
  /** SID de plantilla aprobada Meta (HX...) — para mensajes en frío. */
  template_sid?: string;
  /** Variables de la plantilla {{1}}, {{2}}... */
  template_variables?: Record<string, string>;
  /** Metadata para registrar en whatsapp_sends y timeline (opcional). */
  company_id?: string;
  user_id?: string | null;
  customer_id?: string | null;
  lead_id?: string | null;
  related_subject_type?: string | null;
  related_subject_id?: string | null;
}

export interface SendWhatsAppResult {
  ok: boolean;
  message_sid: string | null;
  error_code: string | null;
  error_message: string | null;
}

export async function sendWhatsApp(
  input: SendWhatsAppInput,
): Promise<SendWhatsAppResult> {
  if (!isWhatsAppConfigured()) {
    return {
      ok: false,
      message_sid: null,
      error_code: "NOT_CONFIGURED",
      error_message: "WhatsApp no configurado en el servidor",
    };
  }

  // RGPD — bloqueo si data_processing revocado.
  if (input.customer_id) {
    try {
      const { createAdminClient } = await import("@/shared/lib/supabase/admin");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const { data: dpRow } = await admin
        .from("customer_consents")
        .select("granted")
        .eq("customer_id", input.customer_id)
        .eq("kind", "data_processing")
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dpRow && (dpRow as { granted: boolean }).granted === false) {
        return {
          ok: false,
          message_sid: null,
          error_code: "RGPD_REVOKED",
          error_message:
            "El cliente revocó el tratamiento de datos. No se le puede enviar WhatsApp.",
        };
      }
    } catch {
      /* fail-soft: si falla la query, no bloqueamos */
    }
  }

  const phone = normalizePhoneE164(input.to_phone);
  if (!phone) {
    return {
      ok: false,
      message_sid: null,
      error_code: "INVALID_PHONE",
      error_message: `Teléfono inválido: ${input.to_phone}`,
    };
  }

  try {
    const client = getTwilio();
    const from = process.env.WHATSAPP_TWILIO_FROM!;
    const params: {
      from: string;
      to: string;
      body?: string;
      contentSid?: string;
      contentVariables?: string;
    } = {
      from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
      to: `whatsapp:${phone}`,
    };
    if (input.template_sid) {
      params.contentSid = input.template_sid;
      if (input.template_variables) {
        params.contentVariables = JSON.stringify(input.template_variables);
      }
    } else {
      params.body = input.body;
    }

    const msg = await client.messages.create(params);
    const result: SendWhatsAppResult = {
      ok: true,
      message_sid: msg.sid,
      error_code: null,
      error_message: null,
    };
    await persistWhatsAppSend(input, result);
    return result;
  } catch (e) {
    const err = e as { code?: string | number; message?: string };
    const result: SendWhatsAppResult = {
      ok: false,
      message_sid: null,
      error_code: String(err.code ?? "TWILIO_ERROR"),
      error_message: err.message ?? "Error Twilio",
    };
    await persistWhatsAppSend(input, result);
    return result;
  }
}

/**
 * Persiste el envío en whatsapp_sends + evento timeline. Fail-soft: si la
 * tabla no existe o falta company_id, no rompe el envío.
 */
async function persistWhatsAppSend(
  input: SendWhatsAppInput,
  result: SendWhatsAppResult,
): Promise<void> {
  if (!input.company_id) return; // Sin contexto multi-tenant, no se puede persistir
  try {
    const { createAdminClient } = await import("@/shared/lib/supabase/admin");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("whatsapp_sends")
      .insert({
        company_id: input.company_id,
        user_id: input.user_id ?? null,
        to_phone: input.to_phone,
        body: input.body,
        template_sid: input.template_sid ?? null,
        template_variables: input.template_variables ?? null,
        status: result.ok ? "sent" : "failed",
        message_sid: result.message_sid,
        error_code: result.error_code,
        error_message: result.error_message,
        sent_at: result.ok ? new Date().toISOString() : null,
        customer_id: input.customer_id ?? null,
        lead_id: input.lead_id ?? null,
        related_subject_type: input.related_subject_type ?? null,
        related_subject_id: input.related_subject_id ?? null,
      })
      .select("id")
      .single();
    const sendId = (row as { id: string } | null)?.id;
    if (sendId && result.ok) {
      try {
        await admin.from("events").insert({
          company_id: input.company_id,
          subject_type:
            input.related_subject_type ??
            (input.customer_id ? "customer" : input.lead_id ? "lead" : "company"),
          subject_id:
            input.related_subject_id ??
            input.customer_id ??
            input.lead_id ??
            input.company_id,
          kind: "whatsapp.sent",
          payload: {
            whatsapp_send_id: sendId,
            to_phone: input.to_phone,
            template_sid: input.template_sid ?? null,
          },
          actor_user_id: input.user_id ?? null,
        });
      } catch {
        /* fail-soft */
      }
    }
  } catch (e) {
    console.error("[persistWhatsAppSend] failed:", e);
  }
}

/** Normaliza teléfono español a +34XXXXXXXXX. */
function normalizePhoneE164(raw: string): string | null {
  const clean = raw.replace(/[\s\-.()]/g, "");
  if (clean.startsWith("+")) {
    return /^\+\d{8,15}$/.test(clean) ? clean : null;
  }
  if (clean.startsWith("0034")) {
    return `+34${clean.slice(4)}`;
  }
  if (clean.startsWith("34") && clean.length === 11) {
    return `+${clean}`;
  }
  if (/^[6789]\d{8}$/.test(clean)) {
    return `+34${clean}`;
  }
  return null;
}
