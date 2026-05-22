"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { DEFAULT_POINTS_SETTINGS, type PointsSettings } from "./settings";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getPointsSettingsAdmin(): Promise<PointsSettings> {
  const session = await ensureAdmin();
  if (!session.company_id) return DEFAULT_POINTS_SETTINGS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select("points_settings")
    .eq("company_id", session.company_id)
    .maybeSingle();
  const stored = (data?.points_settings ?? {}) as Partial<PointsSettings>;
  return { ...DEFAULT_POINTS_SETTINGS, ...stored };
}

export async function updatePointsSettingsAction(input: PointsSettings): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ points_settings: input })
      .eq("company_id", session.company_id);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id,
      points_settings: input,
    });
  }
  revalidatePath("/configuracion/puntos");
}

export async function updatePointsSettingsSafeAction(
  input: PointsSettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updatePointsSettingsAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
