"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import {
  GOOGLE_API_PRICING_PER_1K,
  microUsdForCall,
  type GmapsApi,
  type GmapsFeature,
} from "./pricing";
import { resolveServerKey, resolveClientKey } from "./key-storage";

export type GmapsMode = "disabled" | "shared_key" | "own_key";

export interface CompanyGmapsConfig {
  mode: GmapsMode;
  monthly_cap_usd: number;
  daily_cap_usd: number;
  features: Record<GmapsFeature, boolean>;
  alert_email: string | null;
  /** Indica si hay api key configurada y descifrable. */
  has_key: boolean;
  /** Quién paga: 'platform' si shared_key, 'company' si own_key, null si disabled. */
  pays: "platform" | "company" | null;
}

const DEFAULT_FEATURES: Record<GmapsFeature, boolean> = {
  interactive_maps: false,
  smart_routes: false,
  directions: false,
  static_pdfs: false,
  street_view: false,
  anti_fraud_roads: false,
};

/**
 * Carga la configuración Google Maps de la empresa. Cache 60 s por
 * proceso para evitar hacer SELECT en cada llamada de tracking.
 */
const configCache = new Map<
  string,
  { at: number; data: CompanyGmapsConfig & { encrypted_key: string | null } }
>();
const CONFIG_TTL_MS = 60 * 1000;

export async function loadGoogleMapsConfig(
  companyId: string,
): Promise<CompanyGmapsConfig> {
  const cached = configCache.get(companyId);
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) {
    return stripKey(cached.data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: c } = await admin
    .from("companies")
    .select("gmaps_mode, gmaps_monthly_cap_usd, gmaps_daily_cap_usd")
    .eq("id", companyId)
    .maybeSingle();
  const { data: s } = await admin
    .from("company_settings")
    .select("gmaps_features, gmaps_api_key_encrypted, gmaps_alert_email")
    .eq("company_id", companyId)
    .maybeSingle();

  type CRow = {
    gmaps_mode: GmapsMode | null;
    gmaps_monthly_cap_usd: number | null;
    gmaps_daily_cap_usd: number | null;
  };
  type SRow = {
    gmaps_features: Partial<Record<GmapsFeature, boolean>> | null;
    gmaps_api_key_encrypted: string | null;
    gmaps_alert_email: string | null;
  };
  const company = (c ?? null) as CRow | null;
  const settings = (s ?? null) as SRow | null;

  const mode: GmapsMode = company?.gmaps_mode ?? "disabled";
  const encrypted_key = settings?.gmaps_api_key_encrypted ?? null;
  const has_key =
    mode === "shared_key"
      ? Boolean(process.env.GOOGLE_MAPS_PLATFORM_SERVER_KEY)
      : mode === "own_key"
        ? Boolean(encrypted_key)
        : false;

  const data: CompanyGmapsConfig & { encrypted_key: string | null } = {
    mode,
    monthly_cap_usd: Number(company?.gmaps_monthly_cap_usd ?? 50),
    daily_cap_usd: Number(company?.gmaps_daily_cap_usd ?? 10),
    features: { ...DEFAULT_FEATURES, ...(settings?.gmaps_features ?? {}) },
    alert_email: settings?.gmaps_alert_email ?? null,
    has_key,
    pays:
      mode === "disabled"
        ? null
        : mode === "shared_key"
          ? "platform"
          : "company",
    encrypted_key,
  };
  configCache.set(companyId, { at: Date.now(), data });
  return stripKey(data);
}

function stripKey(
  d: CompanyGmapsConfig & { encrypted_key: string | null },
): CompanyGmapsConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encrypted_key, ...rest } = d;
  return rest;
}

/** Invalida la cache tras un cambio de settings o de empresa. */
export async function invalidateGoogleMapsConfig(companyId: string): Promise<void> {
  configCache.delete(companyId);
}

/**
 * Decide si la empresa puede usar Google Maps para una feature dada.
 * Aplica:
 *  · modo != disabled
 *  · feature toggle ON (geocoding/autocomplete son implícitos)
 *  · hay key resoluble (platform o propia)
 *  · no se ha pasado del cap diario ni mensual
 *
 * Devuelve `{ ok: true, key }` o `{ ok: false, reason }` para que el
 * caller pueda hacer fallback a OSM con razón clara en logs.
 */
export async function canUseGoogleMaps(args: {
  companyId: string;
  /** Una feature opcional. Si se omite, basta con que el módulo esté activo. */
  feature?: GmapsFeature;
}): Promise<
  | { ok: true; key: string; mode: GmapsMode }
  | { ok: false; reason: string }
> {
  const cfg = await loadGoogleMapsConfig(args.companyId);
  if (cfg.mode === "disabled") {
    return { ok: false, reason: "Módulo Google Maps no activado para la empresa" };
  }
  if (!cfg.has_key) {
    return { ok: false, reason: "Sin API key configurada" };
  }
  // Features opcionales: hay que tenerlas activas. Geocoding/Autocomplete
  // son implícitos al activar el módulo.
  if (args.feature && !cfg.features[args.feature]) {
    return { ok: false, reason: `Feature ${args.feature} desactivada` };
  }

  // Cap diario y mensual
  const [day, month] = await Promise.all([
    getUsageUsd(args.companyId, "day"),
    getUsageUsd(args.companyId, "month"),
  ]);
  if (day >= cfg.daily_cap_usd) {
    return {
      ok: false,
      reason: `Tope diario alcanzado ($${day.toFixed(2)} / $${cfg.daily_cap_usd})`,
    };
  }
  if (month >= cfg.monthly_cap_usd) {
    return {
      ok: false,
      reason: `Tope mensual alcanzado ($${month.toFixed(2)} / $${cfg.monthly_cap_usd})`,
    };
  }

  // Cargar la key con acceso a encrypted_key (releer desde cache interna).
  const cached = configCache.get(args.companyId);
  const key = resolveServerKey({
    mode: cfg.mode,
    encryptedKey: cached?.data.encrypted_key ?? null,
  });
  if (!key) return { ok: false, reason: "Key no resoluble" };
  return { ok: true, key, mode: cfg.mode };
}

/** Igual pero devuelve la key client-public. */
export async function getClientKeyForCompany(
  companyId: string,
): Promise<{ key: string | null; mode: GmapsMode }> {
  const cfg = await loadGoogleMapsConfig(companyId);
  if (cfg.mode === "disabled") return { key: null, mode: cfg.mode };
  const cached = configCache.get(companyId);
  const key = resolveClientKey({
    mode: cfg.mode,
    encryptedKey: cached?.data.encrypted_key ?? null,
  });
  return { key, mode: cfg.mode };
}

/**
 * Registra una llamada a Google. Idempotente: si falla el insert
 * (RLS, BD caída), no rompe el flujo principal — devuelve silent.
 */
export async function trackGoogleApiCall(args: {
  companyId: string;
  api: GmapsApi;
  endpoint?: string;
  units?: number;
  userId?: string | null;
  success?: boolean;
  errorCode?: string | null;
}): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const cost = microUsdForCall(args.api, args.units ?? 1);
    await admin.from("google_api_usage").insert({
      company_id: args.companyId,
      api: args.api,
      endpoint: args.endpoint ?? null,
      units: args.units ?? 1,
      cost_micro_usd: cost,
      called_by_user_id: args.userId ?? null,
      success: args.success ?? true,
      error_code: args.errorCode ?? null,
    });
  } catch (e) {
    console.error("[trackGoogleApiCall] insert failed:", e);
  }
}

async function getUsageUsd(
  companyId: string,
  scope: "day" | "month",
): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const since = new Date();
    if (scope === "day") {
      since.setHours(0, 0, 0, 0);
    } else {
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
    }
    const { data } = await admin
      .from("google_api_usage")
      .select("cost_micro_usd")
      .eq("company_id", companyId)
      .eq("success", true)
      .gte("called_at", since.toISOString());
    const rows = (data ?? []) as Array<{ cost_micro_usd: number }>;
    const microSum = rows.reduce((s, r) => s + Number(r.cost_micro_usd ?? 0), 0);
    return microSum / 1_000_000;
  } catch {
    return 0;
  }
}

/**
 * Resumen para el dashboard /configuracion/google-maps. Cero queries
 * sobre tablas distintas — todo viene de google_api_usage.
 */
export interface GmapsUsageSummary {
  current_month_usd: number;
  current_day_usd: number;
  by_api: Array<{ api: GmapsApi; calls: number; units: number; usd: number }>;
  by_user: Array<{ user_id: string; user_name: string | null; calls: number; usd: number }>;
  history: Array<{ month: string; usd: number }>;
}

export async function getGmapsUsageSummary(
  companyId: string,
): Promise<GmapsUsageSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Por API y por usuario (mes actual)
  const { data: monthRows } = await admin
    .from("google_api_usage")
    .select("api, units, cost_micro_usd, called_by_user_id")
    .eq("company_id", companyId)
    .eq("success", true)
    .gte("called_at", monthStart.toISOString());
  type R = {
    api: GmapsApi;
    units: number;
    cost_micro_usd: number;
    called_by_user_id: string | null;
  };
  const month = (monthRows ?? []) as R[];

  const byApi = new Map<GmapsApi, { calls: number; units: number; cost: number }>();
  const byUser = new Map<string, { calls: number; cost: number }>();
  let currentMonthMicro = 0;
  for (const r of month) {
    currentMonthMicro += Number(r.cost_micro_usd);
    const prev = byApi.get(r.api) ?? { calls: 0, units: 0, cost: 0 };
    prev.calls += 1;
    prev.units += Number(r.units);
    prev.cost += Number(r.cost_micro_usd);
    byApi.set(r.api, prev);
    if (r.called_by_user_id) {
      const u = byUser.get(r.called_by_user_id) ?? { calls: 0, cost: 0 };
      u.calls += 1;
      u.cost += Number(r.cost_micro_usd);
      byUser.set(r.called_by_user_id, u);
    }
  }

  let currentDayMicro = 0;
  const { data: dayRows } = await admin
    .from("google_api_usage")
    .select("cost_micro_usd")
    .eq("company_id", companyId)
    .eq("success", true)
    .gte("called_at", dayStart.toISOString());
  currentDayMicro = ((dayRows ?? []) as Array<{ cost_micro_usd: number }>).reduce(
    (s, r) => s + Number(r.cost_micro_usd),
    0,
  );

  // Histórico 6 meses
  const { data: histRows } = await admin
    .from("google_api_usage")
    .select("called_at, cost_micro_usd")
    .eq("company_id", companyId)
    .eq("success", true)
    .gte("called_at", sixMonthsAgo.toISOString());
  type HR = { called_at: string; cost_micro_usd: number };
  const histMap = new Map<string, number>();
  for (const r of (histRows ?? []) as HR[]) {
    const d = new Date(r.called_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    histMap.set(key, (histMap.get(key) ?? 0) + Number(r.cost_micro_usd));
  }
  const history: Array<{ month: string; usd: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    history.push({ month: key, usd: (histMap.get(key) ?? 0) / 1_000_000 });
  }

  // Nombres de usuarios
  const userIds = Array.from(byUser.keys());
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profs ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      if (p.full_name) nameMap.set(p.user_id, p.full_name);
    }
  }

  return {
    current_month_usd: currentMonthMicro / 1_000_000,
    current_day_usd: currentDayMicro / 1_000_000,
    by_api: Array.from(byApi.entries())
      .map(([api, v]) => ({
        api,
        calls: v.calls,
        units: v.units,
        usd: v.cost / 1_000_000,
      }))
      .sort((a, b) => b.usd - a.usd),
    by_user: Array.from(byUser.entries())
      .map(([user_id, v]) => ({
        user_id,
        user_name: nameMap.get(user_id) ?? null,
        calls: v.calls,
        usd: v.cost / 1_000_000,
      }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10),
    history,
  };
}

export { GOOGLE_API_PRICING_PER_1K };
