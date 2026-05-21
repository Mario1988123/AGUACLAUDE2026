"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { SLA_DEFAULTS, type SlaSettings } from "./sla-types";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getSlaSettings(): Promise<SlaSettings> {
  const session = await requireSession();
  if (!session.company_id) return SLA_DEFAULTS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select("sla_settings")
    .eq("company_id", session.company_id)
    .maybeSingle();
  const stored = (data?.sla_settings ?? {}) as Partial<SlaSettings>;
  return {
    low: stored.low ?? SLA_DEFAULTS.low,
    medium: stored.medium ?? SLA_DEFAULTS.medium,
    high: stored.high ?? SLA_DEFAULTS.high,
    critical: stored.critical ?? SLA_DEFAULTS.critical,
  };
}

export async function updateSlaSettingsAction(input: SlaSettings): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  for (const k of ["low", "medium", "high", "critical"] as const) {
    const v = input[k];
    if (!Number.isFinite(v) || v <= 0 || v > 8760) {
      throw new Error(`Plazo de ${k} inválido (debe estar entre 1 y 8760 horas)`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id, sla_settings")
    .eq("company_id", session.company_id)
    .maybeSingle();
  const merged = {
    ...((existing?.sla_settings as Record<string, unknown>) ?? {}),
    low: input.low,
    medium: input.medium,
    high: input.high,
    critical: input.critical,
  };
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ sla_settings: merged })
      .eq("company_id", session.company_id);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id,
      sla_settings: merged,
    });
  }
  revalidatePath("/configuracion/incidencias");
}

export async function updateSlaSettingsSafeAction(
  input: SlaSettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateSlaSettingsAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
