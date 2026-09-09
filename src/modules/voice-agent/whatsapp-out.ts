import "server-only";
import { sendWhatsApp } from "@/modules/mailing/whatsapp";
import { siteBaseUrl } from "@/shared/lib/site-url";
import type { VoiceSettings } from "./settings";

/**
 * El cierre por WhatsApp de una llamada.
 *
 * Una llamada no deja rastro escrito: el cliente cuelga y a los dos días no
 * recuerda si era el jueves o el viernes. Un WhatsApp con la fecha resuelve
 * eso, sube la asistencia a la cita y —lo que a veces importa más— deja prueba
 * de lo que se acordó.
 *
 * Todo aquí es *fail-soft* a propósito. Si el WhatsApp no sale, la cita ya está
 * confirmada en la agenda: el mensaje es un extra, y hacer fracasar una llamada
 * que ha ido bien porque Twilio devuelve un 500 sería absurdo.
 */

export interface VoiceConfirmationInput {
  companyId: string;
  settings: VoiceSettings;
  toPhone: string;
  customerId: string | null;
  jobId: string;
  /** Token público del flujo `/m/[token]`, ya existente. */
  token: string;
  /** Fecha elegida (YYYY-MM-DD) o null si confirmó la que ya tenía. */
  date: string | null;
  slot: "morning" | "afternoon";
}

export interface VoiceConfirmationResult {
  sent: boolean;
  reason?: string;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function humanDate(date: string, slot: "morning" | "afternoon"): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const franja = slot === "morning" ? "por la mañana" : "por la tarde";
  return `${d} de ${MESES[m - 1]} ${franja}`;
}

/**
 * Manda la confirmación de la cita tras la llamada.
 *
 * Solo sale si la empresa lo ha activado explícitamente
 * (`whatsapp_confirm_enabled`). Está apagado por defecto porque mandar un
 * WhatsApp desde un número que el cliente no reconoce, justo después de una
 * llamada de un robot, genera más desconfianza que tranquilidad — y eso hay
 * que decidirlo empresa por empresa, no globalmente.
 */
export async function sendVoiceConfirmation(
  input: VoiceConfirmationInput,
): Promise<VoiceConfirmationResult> {
  if (!input.settings.whatsapp_confirm_enabled) {
    return { sent: false, reason: "disabled" };
  }

  const sender = resolveSender(input.settings);
  if (!sender) {
    // Mejor no mandar nada que mandarlo desde el número de otra empresa.
    console.warn(
      `[voice-agent] confirmación WhatsApp omitida en ${input.companyId}: sin sender propio`,
    );
    return { sent: false, reason: "no_sender" };
  }

  const cuando = input.date ? humanDate(input.date, input.slot) : "la fecha acordada";
  const enlace = `${siteBaseUrl().replace(/\/$/, "")}/m/${input.token}`;

  const body =
    `Hola, le confirmamos la visita de mantenimiento para el ${cuando}. ` +
    `Si necesita cambiarla, puede hacerlo aquí: ${enlace}`;

  try {
    const r = await sendWhatsApp({
      to_phone: input.toPhone,
      body,
      from_override: sender,
      company_id: input.companyId,
      user_id: null,
      customer_id: input.customerId,
      related_subject_type: "maintenance",
      related_subject_id: input.jobId,
    });
    if (!r.ok) {
      console.warn(
        `[voice-agent] confirmación WhatsApp falló: ${r.error_code} ${r.error_message}`,
      );
      return { sent: false, reason: r.error_code ?? "send_failed" };
    }
    return { sent: true };
  } catch (e) {
    console.error("[voice-agent] sendVoiceConfirmation", e);
    return { sent: false, reason: "exception" };
  }
}

/**
 * Qué número usa esta empresa para escribir.
 *
 * Devuelve `null` antes que caer al sender global cuando hay más de un tenant
 * en juego. El global (`WHATSAPP_TWILIO_FROM`) solo se admite si la instalación
 * lo ha marcado explícitamente como aceptable — en la práctica, en desarrollo y
 * en pruebas con un único cliente.
 *
 * El motivo es concreto: con un sender compartido, el cliente de la empresa A
 * recibe mensajes desde el mismo número que el cliente de la empresa B, y si
 * alguno responde, el mensaje entrante no se puede enrutar a nadie. Es la fuga
 * de contexto entre empresas que ya señalaba la investigación.
 */
function resolveSender(settings: VoiceSettings): string | null {
  if (settings.whatsapp_sender) {
    const s = settings.whatsapp_sender.trim();
    return s.startsWith("whatsapp:") ? s : `whatsapp:${s}`;
  }
  if (process.env.VOICE_ALLOW_SHARED_WHATSAPP_SENDER === "true") {
    const global = process.env.WHATSAPP_TWILIO_FROM;
    if (!global) return null;
    return global.startsWith("whatsapp:") ? global : `whatsapp:${global}`;
  }
  return null;
}
