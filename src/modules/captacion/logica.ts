import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lógica pura del módulo de captación (sin base de datos ni red), para poder
 * probarla con vitest. Verificado contra la documentación de Meta el
 * 2026-11-25 (webhooks: create-webhook-endpoint, reference/messages,
 * message_template_status_update, account_update).
 */

// -----------------------------------------------------------------------------
// Firma del webhook
// -----------------------------------------------------------------------------

/**
 * Verifica `X-Hub-Signature-256: sha256=<hex>`: HMAC-SHA256 del cuerpo crudo
 * con el secreto de la app. Comparación en tiempo constante. Sin secreto, no
 * se acepta nada.
 */
export function verificarFirmaMeta(
  cuerpoCrudo: string,
  cabecera: string | null | undefined,
  secreto: string | null | undefined,
): boolean {
  if (!secreto || !cabecera) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecera.trim());
  if (!m) return false;
  const esperado = createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest();
  const recibido = Buffer.from(m[1]!.toLowerCase(), "hex");
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(esperado, recibido);
}

/** Comparación en tiempo constante del verify_token del alta del webhook. */
export function tokenVerificacionValido(
  recibido: string | null | undefined,
  esperado: string | null | undefined,
): boolean {
  if (!recibido || !esperado) return false;
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

// -----------------------------------------------------------------------------
// Carga del webhook
// -----------------------------------------------------------------------------

export interface CambioMeta {
  field?: string;
  value?: Record<string, unknown> & {
    metadata?: { phone_number_id?: string; display_phone_number?: string };
    messages?: Array<{ id?: string }>;
    statuses?: Array<{ id?: string; status?: string }>;
  };
}

export interface EntradaMeta {
  id?: string;
  changes?: CambioMeta[];
}

export interface CargaMeta {
  object?: string;
  entry?: EntradaMeta[];
}

export interface EventoPlano {
  campo: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  claveDedupe: string;
  cuerpo: { entry_id: string | null; field: string; value: unknown };
}

/**
 * Clave para no guardar dos veces lo mismo: Meta reintenta hasta 7 días y
 * puede mandar duplicados.
 *  · mensajes → los wamid
 *  · estados  → wamid + estado (el mismo mensaje pasa por sent, delivered, read)
 *  · el resto → hash del cambio
 */
export function claveDedupe(entryId: string | null, cambio: CambioMeta): string {
  const campo = cambio.field ?? "desconocido";
  const v = cambio.value ?? {};
  const mensajes = (v.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  const estados = (v.statuses ?? [])
    .map((s) => (s.id && s.status ? `${s.id}:${s.status}` : null))
    .filter(Boolean) as string[];
  if (mensajes.length > 0 && estados.length === 0) return `msg:${mensajes.sort().join(",")}`;
  if (estados.length > 0 && mensajes.length === 0) return `st:${estados.sort().join(",")}`;
  const hash = createHash("sha256")
    .update(JSON.stringify({ e: entryId, f: campo, v }))
    .digest("hex");
  return `h:${campo}:${hash}`;
}

/** Aplana la carga en un evento por cambio. Ignora lo que no es de WhatsApp. */
export function aplanarCarga(carga: CargaMeta): EventoPlano[] {
  if (carga?.object !== "whatsapp_business_account" || !Array.isArray(carga.entry)) return [];
  const out: EventoPlano[] = [];
  for (const entry of carga.entry) {
    const entryId = typeof entry?.id === "string" ? entry.id : null;
    for (const cambio of entry?.changes ?? []) {
      const campo = cambio?.field ?? "desconocido";
      const pnid = cambio?.value?.metadata?.phone_number_id;
      out.push({
        campo,
        wabaId: entryId,
        phoneNumberId: typeof pnid === "string" ? pnid : null,
        claveDedupe: claveDedupe(entryId, cambio),
        cuerpo: { entry_id: entryId, field: campo, value: cambio?.value ?? null },
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Traducciones de Meta
// -----------------------------------------------------------------------------

export type EstadoPlantilla = "aprobada" | "pendiente" | "rechazada" | "pausada" | "desactivada";

/** Estado de plantilla de Meta (status de la API o event del webhook). */
export function traducirEstadoPlantilla(estadoMeta: string | null | undefined): EstadoPlantilla {
  switch ((estadoMeta ?? "").toUpperCase()) {
    case "APPROVED":
    case "REINSTATED":
    case "UNARCHIVED":
      return "aprobada";
    case "REJECTED":
      return "rechazada";
    case "PAUSED":
    case "FLAGGED":
    case "LIMIT_EXCEEDED":
    case "LOCKED":
      return "pausada";
    case "DISABLED":
    case "DELETED":
    case "ARCHIVED":
    case "PENDING_DELETION":
      return "desactivada";
    default: // PENDING, IN_APPEAL, desconocido
      return "pendiente";
  }
}

export type Categoria = "marketing" | "utility" | "authentication";

export function traducirCategoria(c: string | null | undefined): Categoria | null {
  const v = (c ?? "").toUpperCase();
  if (v === "MARKETING") return "marketing";
  if (v === "UTILITY") return "utility";
  if (v === "AUTHENTICATION") return "authentication";
  return null;
}

export type Calidad = "verde" | "amarilla" | "roja" | "desconocida";

export function traducirCalidad(q: string | null | undefined): Calidad {
  switch ((q ?? "").toUpperCase()) {
    case "GREEN":
      return "verde";
    case "YELLOW":
      return "amarilla";
    case "RED":
      return "roja";
    default:
      return "desconocida";
  }
}

/**
 * Límite diario de Meta a partir de `whatsapp_business_manager_messaging_limit`
 * (p. ej. "TIER_250", "TIER_2K", "TIER_UNLIMITED"). Devuelve null si no se
 * entiende: mejor dejar el valor guardado que inventar uno.
 */
export function traducirLimite(tier: string | null | undefined): number | null {
  const m = /^TIER_(\d+)(K)?$/i.exec((tier ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] ? n * 1000 : n;
}

/** Número de Meta («+34 682 66 37 97») a E.164 («+34682663797»). */
export function aE164(numero: string | null | undefined): string | null {
  if (!numero) return null;
  const digitos = numero.replace(/\D/g, "");
  return digitos.length >= 8 ? `+${digitos}` : null;
}

/** PIN de 6 dígitos para el registro del número en la Cloud API. */
export function generarPin(aleatorio: (n: number) => Buffer): string {
  const n = aleatorio(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}
