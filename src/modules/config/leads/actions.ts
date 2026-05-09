"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export interface LeadsConfig {
  expiry_days: number; // legacy / fallback
  expiry_days_tmk: number;
  expiry_days_commercial: number;
}

export async function getLeadsConfig(): Promise<LeadsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let data: {
    lead_expiry_days?: number;
    lead_expiry_days_tmk?: number;
    lead_expiry_days_commercial?: number;
  } | null = null;
  try {
    const r = await supabase
      .from("company_settings")
      .select("lead_expiry_days, lead_expiry_days_tmk, lead_expiry_days_commercial")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    data = r.data;
  } catch {
    // Migración aún no aplicada → solo legacy
    const r = await supabase
      .from("company_settings")
      .select("lead_expiry_days")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    data = r.data;
  }
  const legacy = data?.lead_expiry_days ?? 30;
  return {
    expiry_days: legacy,
    expiry_days_tmk: data?.lead_expiry_days_tmk ?? 15,
    expiry_days_commercial: data?.lead_expiry_days_commercial ?? legacy,
  };
}

export async function updateLeadsConfigAction(input: {
  expiry_days?: number;
  expiry_days_tmk?: number;
  expiry_days_commercial?: number;
}) {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const clamp = (v: number | undefined, fallback: number) =>
    Math.max(1, Math.min(365, Number(v) || fallback));
  const tmk = clamp(input.expiry_days_tmk, 15);
  const commercial = clamp(input.expiry_days_commercial, 30);
  const legacy = clamp(input.expiry_days, commercial);

  const payload: Record<string, unknown> = {
    lead_expiry_days: legacy,
    lead_expiry_days_tmk: tmk,
    lead_expiry_days_commercial: commercial,
  };

  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  let r;
  if (existing) {
    r = await supabase
      .from("company_settings")
      .update(payload)
      .eq("company_id", session.company_id!);
  } else {
    r = await supabase
      .from("company_settings")
      .insert({ company_id: session.company_id!, ...payload });
  }
  // Defensa: si las columnas nuevas no existen aún, reintentar con las legacy
  if (
    r?.error &&
    /lead_expiry_days_(tmk|commercial)/i.test(r.error.message ?? "")
  ) {
    if (existing) {
      await supabase
        .from("company_settings")
        .update({ lead_expiry_days: legacy })
        .eq("company_id", session.company_id!);
    } else {
      await supabase
        .from("company_settings")
        .insert({ company_id: session.company_id!, lead_expiry_days: legacy });
    }
  }
  revalidatePath("/configuracion/leads");
}
