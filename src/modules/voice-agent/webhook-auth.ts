import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los webhooks del agente de voz.
 *
 * Vive aparte porque la usan dos rutas —la de entrada de llamada y la de
 * cierre— y una divergencia entre ambas sería justo el tipo de fallo que no
 * se nota hasta que alguien lo explota: bastaría con que una de las dos
 * verificara peor para tener una puerta abierta.
 *
 * Sin `VOICE_WEBHOOK_SECRET` no se acepta nada. Un webhook abierto permite a
 * cualquiera abrir llamadas falsas, inyectar transcripciones, cerrar llamadas
 * ajenas y descuadrar el contador de gasto — y en el caso del webhook de
 * entrada, obtener el guion completo y el nombre del cliente asociado a un
 * teléfono cualquiera.
 */
export function verifyVoiceSignature(req: Request, raw: string): boolean {
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[voice-agent] VOICE_WEBHOOK_SECRET sin configurar");
    return false;
  }

  const header =
    req.headers.get("elevenlabs-signature") ??
    req.headers.get("x-hm-voice-signature") ??
    "";
  if (!header) return false;

  // Formato ElevenLabs: "t=<timestamp>,v0=<hmac>"
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;

  const timestamp = parts.t;
  const provided = parts.v0 ?? header;

  // Ventana de 30 min contra el reenvío de una petición capturada.
  if (timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 1800) return false;
  }

  const payload = timestamp ? `${timestamp}.${raw}` : raw;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
