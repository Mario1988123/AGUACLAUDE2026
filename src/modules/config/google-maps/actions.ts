"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  invalidateGoogleMapsConfig,
  loadGoogleMapsConfig,
  type CompanyGmapsConfig,
} from "@/shared/lib/google-maps/config";
import { encryptGmapsKey } from "@/shared/lib/google-maps/key-storage";
import type { GmapsFeature } from "@/shared/lib/google-maps/pricing";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin de empresa");
  }
  if (!session.company_id) throw new Error("Sin empresa");
  return session as typeof session & { company_id: string };
}

export async function getMyGmapsConfig(): Promise<CompanyGmapsConfig> {
  const session = await requireSession();
  if (!session.company_id) {
    return {
      mode: "disabled",
      monthly_cap_usd: 0,
      daily_cap_usd: 0,
      features: {
        interactive_maps: false,
        smart_routes: false,
        directions: false,
        static_pdfs: false,
        street_view: false,
        anti_fraud_roads: false,
      },
      alert_email: null,
      has_key: false,
      pays: null,
    };
  }
  return loadGoogleMapsConfig(session.company_id);
}

/**
 * Guarda la API key Google del admin. La cifra antes de persistir.
 * Solo modo own_key.
 */
export async function setGmapsApiKeySafeAction(
  rawKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const key = (rawKey ?? "").trim();
    if (!key) {
      // Vaciar la key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      await admin
        .from("company_settings")
        .update({
          gmaps_api_key_encrypted: null,
          gmaps_api_key_set_at: null,
        })
        .eq("company_id", session.company_id);
      await invalidateGoogleMapsConfig(session.company_id!);
      revalidatePath("/configuracion/google-maps");
      return { ok: true };
    }
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) {
      return {
        ok: false,
        error:
          "Formato de API key inválido. Debe empezar por 'AIza' y tener al menos 34 caracteres.",
      };
    }
    const encrypted = encryptGmapsKey(key);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Upsert por si no existe la fila aún
    const { data: existing } = await admin
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (existing) {
      const { error } = await admin
        .from("company_settings")
        .update({
          gmaps_api_key_encrypted: encrypted,
          gmaps_api_key_set_at: new Date().toISOString(),
        })
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin.from("company_settings").insert({
        company_id: session.company_id,
        gmaps_api_key_encrypted: encrypted,
        gmaps_api_key_set_at: new Date().toISOString(),
      });
      if (error) return { ok: false, error: error.message };
    }
    await invalidateGoogleMapsConfig(session.company_id!);
    revalidatePath("/configuracion/google-maps");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setGmapsFeaturesSafeAction(
  features: Partial<Record<GmapsFeature, boolean>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: current } = await admin
      .from("company_settings")
      .select("gmaps_features")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const prev = ((current ?? {}) as { gmaps_features?: Record<string, boolean> })
      .gmaps_features ?? {};
    const next = { ...prev, ...features };
    const { error } = await admin
      .from("company_settings")
      .update({ gmaps_features: next })
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    await invalidateGoogleMapsConfig(session.company_id!);
    revalidatePath("/configuracion/google-maps");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setGmapsAlertEmailSafeAction(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const v = (email ?? "").trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return { ok: false, error: "Email inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin
      .from("company_settings")
      .update({ gmaps_alert_email: v || null })
      .eq("company_id", session.company_id);
    await invalidateGoogleMapsConfig(session.company_id!);
    revalidatePath("/configuracion/google-maps");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Anti-fraude geo (settings configurables)
// ─────────────────────────────────────────────────────────────────────

export interface AntiFraudSettings {
  start_max_m: number;
  off_road_threshold_m: number;
}

export async function getAntiFraudSettings(): Promise<AntiFraudSettings> {
  const session = await requireSession();
  if (!session.company_id) return { start_max_m: 200, off_road_threshold_m: 300 };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("company_settings")
      .select("geo_max_distance_start_m, geo_off_road_threshold_m")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const row = (data ?? null) as
      | {
          geo_max_distance_start_m: number | null;
          geo_off_road_threshold_m: number | null;
        }
      | null;
    return {
      start_max_m: Number(row?.geo_max_distance_start_m ?? 200),
      off_road_threshold_m: Number(row?.geo_off_road_threshold_m ?? 300),
    };
  } catch {
    return { start_max_m: 200, off_road_threshold_m: 300 };
  }
}

export async function setAntiFraudSettingsSafeAction(input: {
  start_max_m: number;
  off_road_threshold_m: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const start = Math.round(Number(input.start_max_m));
    const off = Math.round(Number(input.off_road_threshold_m));
    if (!Number.isFinite(start) || start < 0 || start > 10000) {
      return { ok: false, error: "Distancia de inicio inválida (0-10000 m)" };
    }
    if (!Number.isFinite(off) || off < 0 || off > 10000) {
      return { ok: false, error: "Umbral off-road inválido (0-10000 m)" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("company_settings")
      .update({
        geo_max_distance_start_m: start,
        geo_off_road_threshold_m: off,
      })
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/google-maps");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
