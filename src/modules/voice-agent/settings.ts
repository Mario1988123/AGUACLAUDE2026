import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { madridHour, madridIsoDow } from "@/shared/lib/format-date";
import {
  evaluateCallGate,
  type CallPurpose,
  type GateClock,
  type GateResult,
  type GateSettings,
  type GateTarget,
  type PartyKind,
} from "./guardrails";

export interface VoiceSettings extends GateSettings {
  company_id: string;
  provider: string;
  max_attempts: number;
  retry_hours: number;
  max_call_seconds: number;
  escalation_phone: string | null;
  record_audio: boolean;
  transcript_retention_days: number;
  company_pitch: string | null;
  forbidden_topics: string | null;
  tool_secret_hash: string | null;
  usage_month: string | null;
  // --- entrante ---
  inbound_enabled: boolean;
  agent_id_inbound: string | null;
  inbound_can_book: boolean;
  inbound_can_open_incident: boolean;
  transfer_enabled: boolean;
  // --- cierre por WhatsApp ---
  whatsapp_confirm_enabled: boolean;
  whatsapp_sender: string | null;
}

const DEFAULTS = {
  service_enabled: false,
  commercial_enabled: false,
  provider: "elevenlabs",
  agent_id_service: null,
  agent_id_commercial: null,
  caller_id_service: null,
  caller_id_commercial: null,
  service_window_start: 10,
  service_window_end: 20,
  commercial_window_start: 9,
  commercial_window_end: 21,
  max_attempts: 3,
  retry_hours: 24,
  monthly_minutes_cap: 500,
  minutes_used_month: 0,
  max_call_seconds: 300,
  escalation_phone: null,
  record_audio: false,
  transcript_retention_days: 90,
  company_pitch: null,
  forbidden_topics: null,
  tool_secret_hash: null,
  usage_month: null,
  inbound_enabled: false,
  agent_id_inbound: null,
  inbound_can_book: true,
  inbound_can_open_incident: true,
  transfer_enabled: false,
  whatsapp_confirm_enabled: false,
  whatsapp_sender: null,
} as const;

/** Primer día del mes en curso, en formato date de Postgres. */
function currentMonthAnchor(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Lee la configuración del agente de una empresa. Si no hay fila, devuelve los
 * valores por defecto (todo apagado) en vez de null: así el resto del código
 * no tiene que comprobar nulos por todas partes, y una empresa sin configurar
 * simplemente no llama a nadie.
 *
 * Además reinicia el contador de minutos cuando cambia el mes. Se hace en la
 * lectura y no en un cron aparte porque un cron que se olvida de ejecutarse
 * deja el tope bloqueado y la empresa sin llamadas sin saber por qué.
 */
export async function loadVoiceSettings(
  companyId: string,
): Promise<VoiceSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("voice_agent_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!data) return { company_id: companyId, ...DEFAULTS };

  const row = data as Record<string, unknown> & { usage_month: string | null };
  const anchor = currentMonthAnchor();

  // Mes nuevo → el contador vuelve a cero.
  if (row.usage_month !== anchor) {
    await admin
      .from("voice_agent_settings")
      .update({ usage_month: anchor, minutes_used_month: 0 })
      .eq("company_id", companyId);
    row.usage_month = anchor;
    row.minutes_used_month = 0;
  }

  return {
    company_id: companyId,
    ...DEFAULTS,
    ...row,
    minutes_used_month: Number(row.minutes_used_month ?? 0),
  } as VoiceSettings;
}

/**
 * Reloj para el gate, en hora de pared de Madrid. Vercel corre en UTC; si esto
 * usara la hora del servidor, en verano llamaríamos dos horas antes de lo que
 * cree la empresa y en invierno una.
 */
export async function buildClock(
  companyId: string,
  at: Date = new Date(),
): Promise<GateClock> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

  let isHoliday = false;
  try {
    const { data } = await admin
      .from("holidays")
      .select("is_workable, company_id")
      .eq("holiday_date", isoDate)
      .or(`company_id.eq.${companyId},company_id.is.null`);
    isHoliday = ((data ?? []) as Array<{ is_workable: boolean }>).some(
      (h) => h.is_workable === false,
    );
  } catch {
    /* sin tabla de festivos no bloqueamos: el resto del gate sigue aplicando */
  }

  return {
    hour: madridHour(at),
    isoDow: madridIsoDow(at),
    isHoliday,
    nowMs: at.getTime(),
  };
}

export interface ResolvedTarget {
  purpose: CallPurpose;
  party_kind: PartyKind;
  to_phone_e164: string;
  customer_id: string | null;
  lead_id: string | null;
}

/**
 * Completa el target con lo que hay que leer de la base (exclusión, RGPD,
 * base legal comercial) y lo pasa por el gate. Es el único camino por el que
 * el marcador decide llamar.
 */
export async function checkCallAllowed(
  companyId: string,
  target: ResolvedTarget,
  settings?: VoiceSettings,
  at: Date = new Date(),
): Promise<GateResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const s = settings ?? (await loadVoiceSettings(companyId));

  const { data: dnc } = await admin
    .from("voice_do_not_call")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone_e164", target.to_phone_e164)
    .maybeSingle();

  let dataProcessingRevoked = false;
  if (target.customer_id) {
    const { data: dp } = await admin
      .from("customer_consents")
      .select("granted")
      .eq("customer_id", target.customer_id)
      .eq("kind", "data_processing")
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dataProcessingRevoked = (dp as { granted: boolean } | null)?.granted === false;
  }

  let commercialBasis: GateTarget["commercial_basis"] = null;
  let consentGrantedAt: string | null = null;
  if (target.purpose === "commercial" && target.lead_id) {
    // La fila MÁS RECIENTE manda. Es un log append-only: una revocación es una
    // fila nueva con granted=false, así que basta con mirar la última.
    const { data: consent } = await admin
      .from("voice_consents")
      .select("granted, granted_at, basis")
      .eq("company_id", companyId)
      .eq("lead_id", target.lead_id)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const c = consent as
      | { granted: boolean; granted_at: string | null; basis: string | null }
      | null;
    if (c?.granted) {
      commercialBasis = c.basis === "legitimate_interest" ? "legitimate_interest" : "consent";
      consentGrantedAt = c.granted_at;
    } else if (c?.granted === false) {
      // Revocación explícita: no hay base legal, y punto.
      commercialBasis = null;
    } else {
      // Sin fila de consentimiento: para persona JURÍDICA la base por defecto
      // es el interés legítimo del art. 19 LOPDGDD (datos de contacto
      // profesionales), que exige oposición disponible — el agente la ofrece
      // en la llamada y `no_llamar_mas` la ejecuta.
      commercialBasis =
        target.party_kind === "company" ? "legitimate_interest" : null;
    }
  }

  const clock = await buildClock(companyId, at);

  return evaluateCallGate(
    {
      purpose: target.purpose,
      party_kind: target.party_kind,
      to_phone_e164: target.to_phone_e164,
      on_do_not_call: Boolean(dnc),
      data_processing_revoked: dataProcessingRevoked,
      commercial_basis: commercialBasis,
      consent_granted_at: consentGrantedAt,
    },
    s,
    clock,
  );
}

/** Suma minutos consumidos al contador del mes. Idempotente por llamada. */
export async function addMinutesUsed(
  companyId: string,
  minutes: number,
): Promise<void> {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const s = await loadVoiceSettings(companyId);
  await admin
    .from("voice_agent_settings")
    .update({
      minutes_used_month: Number((s.minutes_used_month + minutes).toFixed(2)),
      usage_month: currentMonthAnchor(),
    })
    .eq("company_id", companyId);
}

// ---------------------------------------------------------------------------
// Secreto de herramientas
// ---------------------------------------------------------------------------

export function hashToolSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateToolSecret(): string {
  return `hmv_${randomBytes(24).toString("base64url")}`;
}

/**
 * Resuelve qué empresa está detrás de un secreto presentado por el agente.
 * Comparación en tiempo constante y sobre el hash, nunca sobre el secreto.
 *
 * El `company_id` NUNCA viaja en el prompt ni en el cuerpo de la petición: se
 * deriva de aquí. Es la diferencia entre un agente que no puede salirse de su
 * empresa y uno al que basta con convencerle de que diga otro identificador.
 */
export async function companyFromToolSecret(
  secret: string | null,
): Promise<string | null> {
  if (!secret || secret.length < 16) return null;
  const hash = hashToolSecret(secret);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("voice_agent_settings")
    .select("company_id, tool_secret_hash")
    .eq("tool_secret_hash", hash)
    .maybeSingle();
  if (!data) return null;
  const row = data as { company_id: string; tool_secret_hash: string };
  const a = Buffer.from(row.tool_secret_hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.company_id;
}
