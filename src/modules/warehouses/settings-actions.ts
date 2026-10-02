"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly, zBoolean } from "@/shared/lib/zod-friendly";

export interface WarehouseSettings {
  valuation_method: "PMP" | "FIFO";
  alert_no_rotation_days: number;
  alert_min_company_age_days: number;
  alerts_enabled: {
    below_min: boolean;
    predictive_low: boolean;
    over_max: boolean;
    no_rotation_90d: boolean;
    no_lead_time_set: boolean;
  };
  default_iva_pct: number;
}

const DEFAULTS: WarehouseSettings = {
  valuation_method: "PMP",
  alert_no_rotation_days: 90,
  alert_min_company_age_days: 90,
  alerts_enabled: {
    below_min: true,
    predictive_low: true,
    over_max: true,
    no_rotation_90d: true,
    no_lead_time_set: true,
  },
  default_iva_pct: 21,
};

async function ensureAdminOrDirector() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!ok) throw new Error("Solo admin o director técnico");
  return session;
}

export async function getWarehouseSettings(): Promise<WarehouseSettings> {
  const session = await requireSession();
  if (!session.company_id) return DEFAULTS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("warehouse_settings")
    .select(
      "valuation_method, alert_no_rotation_days, alert_min_company_age_days, alerts_enabled, default_iva_pct",
    )
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (error || !data) return DEFAULTS;
  const d = data as WarehouseSettings;
  return {
    ...DEFAULTS,
    ...d,
    alerts_enabled: { ...DEFAULTS.alerts_enabled, ...(d.alerts_enabled ?? {}) },
  };
}

/**
 * Número obligatorio que llega como texto de un input: "" o espacios dan un
 * error claro en vez de convertirse en 0 (auditoría 2026-10-01: un IVA en
 * blanco se guardaba como IVA del 0 %).
 */
function zNumeroObligatorio(campo: string) {
  return z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z.coerce.number({
      required_error: `Indica ${campo}`,
      invalid_type_error: `Indica ${campo} (un número)`,
    }),
  );
}

const schema = z.object({
  valuation_method: z.enum(["PMP", "FIFO"]),
  alert_no_rotation_days: zNumeroObligatorio("los días sin rotación").pipe(
    z.number().int("Los días sin rotación tienen que ser un número entero").min(1, "Los días sin rotación tienen que ser 1 o más"),
  ),
  alert_min_company_age_days: zNumeroObligatorio("la antigüedad mínima").pipe(
    z.number().int("La antigüedad mínima tiene que ser un número entero").min(0, "La antigüedad mínima no puede ser negativa"),
  ),
  alerts_enabled: z.object({
    below_min: zBoolean(),
    predictive_low: zBoolean(),
    over_max: zBoolean(),
    no_rotation_90d: zBoolean(),
    no_lead_time_set: zBoolean(),
  }),
  default_iva_pct: zNumeroObligatorio("el IVA por defecto").pipe(
    z.number().min(0, "El IVA no puede ser negativo").max(100, "El IVA no puede pasar del 100 %"),
  ),
});

export async function saveWarehouseSettingsAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdminOrDirector();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(schema, input, "Configuración almacenes");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("warehouse_settings")
      .upsert(
        { company_id: session.company_id, ...parsed },
        { onConflict: "company_id" },
      );
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/configuracion/almacenes");
    revalidatePath("/almacenes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
