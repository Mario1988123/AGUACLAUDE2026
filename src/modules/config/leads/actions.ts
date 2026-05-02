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
  expiry_days: number;
}

export async function getLeadsConfig(): Promise<LeadsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select("lead_expiry_days")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  return { expiry_days: (data?.lead_expiry_days as number | undefined) ?? 30 };
}

export async function updateLeadsConfigAction(input: { expiry_days: number }) {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const days = Math.max(1, Math.min(365, Number(input.expiry_days) || 30));

  // Upsert manual: si existe row update, sino insert
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ lead_expiry_days: days })
      .eq("company_id", session.company_id!);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id!,
      lead_expiry_days: days,
    });
  }
  revalidatePath("/configuracion/leads");
}
