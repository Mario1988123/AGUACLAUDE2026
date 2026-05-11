"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { DEFAULT_FREE_TRIAL_CONDITIONS } from "./defaults";

export interface FreeTrialsConfig {
  duration_days: number;
  conditions_text: string;
  default_renting_quote_months: number;
}

const schema = z.object({
  duration_days: z.coerce.number().int().min(1).max(180),
  conditions_text: z.string().optional().default(""),
  default_renting_quote_months: z.coerce.number().int().min(1).max(120).default(48),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getFreeTrialsConfig(): Promise<FreeTrialsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("company_settings")
    .select("extra")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const extra = (data?.extra as Record<string, unknown> | null) ?? {};
  const ft = (extra.free_trials as Record<string, unknown> | undefined) ?? {};
  return {
    duration_days: (ft.duration_days as number | undefined) ?? 30,
    conditions_text:
      (ft.conditions_text as string | undefined) || DEFAULT_FREE_TRIAL_CONDITIONS,
    default_renting_quote_months:
      (ft.default_renting_quote_months as number | undefined) ?? 48,
  };
}

export async function updateFreeTrialsConfig(input: unknown) {
  const session = await ensureAdmin();
  const parsed = schema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("extra")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const baseExtra = (existing?.extra as Record<string, unknown>) ?? {};
  const newExtra = { ...baseExtra, free_trials: parsed };
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ extra: newExtra })
      .eq("company_id", session.company_id!);
  } else {
    await supabase
      .from("company_settings")
      .insert({ company_id: session.company_id!, extra: newExtra });
  }
  revalidatePath("/configuracion/pruebas-gratuitas");
}
