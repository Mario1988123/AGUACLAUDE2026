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
    return {
      ok: true,
      message_sid: msg.sid,
      error_code: null,
      error_message: null,
    };
  } catch (e) {
    const err = e as { code?: string | number; message?: string };
    return {
      ok: false,
      message_sid: null,
      error_code: String(err.code ?? "TWILIO_ERROR"),
      error_message: err.message ?? "Error Twilio",
    };
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
