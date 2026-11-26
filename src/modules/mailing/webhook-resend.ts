/**
 * Lógica pura del webhook de Resend (sin red ni base de datos) para poder
 * probarla con vitest: verificación de la firma Svix y traducción de cada
 * evento a los cambios que hay que escribir en `email_sends` / `email_outbox`.
 */

import crypto from "node:crypto";

export interface EventoResend {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    bounce?: { message?: string; type?: string; subType?: string };
    failed?: { reason?: string };
  };
}

/** Estado actual de la fila que casa con el `email_id` del evento. */
export interface FilaEnvio {
  status?: string | null;
  opens_count?: number | null;
  clicks_count?: number | null;
}

export type ResultadoEvento =
  | { ignorar: false; cambios: Record<string, unknown>; eventoTimeline: string | null }
  | { ignorar: true; motivo: string };

/** Estados que ya no se deben pisar con «delivered» si llega tarde. */
const ESTADOS_FINALES = new Set(["bounced", "complained", "failed"]);
/** Estados que un «delivered» (o una apertura) puede subir a «delivered». */
const ESTADOS_PREVIOS_A_ENTREGA = new Set(["queued", "sending", "sent"]);

/** Ventana anti-repetición de Svix: 5 minutos. */
export const VENTANA_FIRMA_MS = 5 * 60 * 1000;

function quitarPrefijo(secreto: string): string {
  return secreto.startsWith("whsec_") ? secreto.slice(6) : secreto;
}

/** Calcula la firma Svix (`v1,<base64>`) de un cuerpo. Sirve para verificar y para los tests. */
export function firmarSvix(
  cuerpo: string,
  svixId: string,
  svixTimestamp: string,
  secreto: string,
): string {
  const clave = Buffer.from(quitarPrefijo(secreto), "base64");
  const hmac = crypto
    .createHmac("sha256", clave)
    .update(`${svixId}.${svixTimestamp}.${cuerpo}`)
    .digest("base64");
  return `v1,${hmac}`;
}

/**
 * Verifica la firma Svix con la que Resend firma sus webhooks.
 *  · `svix-signature` puede traer varias firmas separadas por espacio
 *    (rotación del secreto); basta con que una coincida.
 *  · El timestamp debe estar dentro de la ventana de 5 minutos.
 */
export function verificarFirmaSvix(args: {
  cuerpo: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  secreto: string;
  ahoraMs?: number;
}): { ok: true } | { ok: false; motivo: "timestamp out of window" | "invalid signature" } {
  const tsMs = parseInt(args.svixTimestamp, 10) * 1000;
  const ahora = args.ahoraMs ?? Date.now();
  if (!Number.isFinite(tsMs) || Math.abs(ahora - tsMs) > VENTANA_FIRMA_MS) {
    return { ok: false, motivo: "timestamp out of window" };
  }
  try {
    const esperada = firmarSvix(args.cuerpo, args.svixId, args.svixTimestamp, args.secreto).slice(3);
    const a = Buffer.from(esperada);
    for (const s of args.svixSignature.split(" ")) {
      const [version, valor] = s.split(",");
      if (version !== "v1" || !valor) continue;
      const b = Buffer.from(valor);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };
    }
  } catch {
    /* secreto mal formado → firma inválida */
  }
  return { ok: false, motivo: "invalid signature" };
}

/** Fecha del evento (la de Resend si es válida; si no, ahora). */
export function fechaDelEvento(evento: EventoResend, ahora: Date = new Date()): string {
  if (evento.created_at) {
    const d = new Date(evento.created_at);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return ahora.toISOString();
}

/**
 * Traduce un evento de Resend a los cambios de la fila de `email_sends`.
 * No sube nunca un estado final (rebote, queja, fallo) a «delivered» si los
 * eventos llegan desordenados.
 */
export function calcularCambiosEvento(
  evento: EventoResend,
  fila: FilaEnvio,
  ahora: Date = new Date(),
): ResultadoEvento {
  const cuando = fechaDelEvento(evento, ahora);
  const estado = fila.status ?? "sent";
  const cambios: Record<string, unknown> = { last_event_at: cuando };

  switch (evento.type) {
    case "email.sent":
      // Resend lo aceptó; nuestra fila ya está en «sent». Solo dejamos huella.
      return { ignorar: false, cambios, eventoTimeline: null };

    case "email.delivered":
      cambios.delivered_at = cuando;
      if (ESTADOS_PREVIOS_A_ENTREGA.has(estado)) cambios.status = "delivered";
      return { ignorar: false, cambios, eventoTimeline: null };

    case "email.opened": {
      const previas = fila.opens_count ?? 0;
      cambios.opened_at = cuando;
      cambios.opens_count = previas + 1;
      // Si se abrió, es que llegó: por si el «delivered» se perdió.
      if (ESTADOS_PREVIOS_A_ENTREGA.has(estado)) cambios.status = "delivered";
      return { ignorar: false, cambios, eventoTimeline: previas === 0 ? "email.opened" : null };
    }

    case "email.clicked": {
      const previos = fila.clicks_count ?? 0;
      cambios.clicked_at = cuando;
      cambios.clicks_count = previos + 1;
      if (ESTADOS_PREVIOS_A_ENTREGA.has(estado)) cambios.status = "delivered";
      return { ignorar: false, cambios, eventoTimeline: previos === 0 ? "email.clicked" : null };
    }

    case "email.bounced": {
      cambios.bounced_at = cuando;
      cambios.status = "bounced";
      const b = evento.data?.bounce;
      if (b?.type || b?.subType) cambios.error_code = [b.type, b.subType].filter(Boolean).join(":");
      if (b?.message) cambios.error_message = b.message;
      return { ignorar: false, cambios, eventoTimeline: "email.bounced" };
    }

    case "email.complained":
      cambios.complained_at = cuando;
      cambios.status = "complained";
      return { ignorar: false, cambios, eventoTimeline: "email.complained" };

    case "email.failed":
      if (ESTADOS_FINALES.has(estado) && estado !== "failed") {
        return { ignorar: false, cambios, eventoTimeline: null };
      }
      cambios.status = "failed";
      cambios.error_message = evento.data?.failed?.reason ?? "Resend no pudo enviar el correo";
      return { ignorar: false, cambios, eventoTimeline: null };

    default:
      return { ignorar: true, motivo: evento.type || "sin tipo" };
  }
}

/** Columnas de `email_outbox` que el webhook puede tocar (su CHECK de status
 *  no admite delivered/bounced, así que el estado se refleja en `error`). */
const COLUMNAS_OUTBOX = new Set([
  "last_event_at",
  "opened_at",
  "opens_count",
  "clicked_at",
  "clicks_count",
]);

export function cambiosParaOutbox(
  evento: EventoResend,
  cambios: Record<string, unknown>,
): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cambios)) if (COLUMNAS_OUTBOX.has(k)) r[k] = v;
  if (evento.type === "email.bounced") {
    r.error = `Rebotado: ${evento.data?.bounce?.message ?? "sin detalle"}`;
  } else if (evento.type === "email.complained") {
    r.error = "El destinatario lo marcó como spam";
  } else if (evento.type === "email.failed") {
    r.status = "failed";
    r.error = evento.data?.failed?.reason ?? "Resend no pudo enviar el correo";
  }
  return r;
}
