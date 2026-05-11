"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface ProposalsConfig {
  default_validity_days: number;
}

const schema = z.object({
  default_validity_days: z.coerce.number().int().min(1).max(365),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getProposalsConfig(): Promise<ProposalsConfig> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let days = 30;
  try {
    const { data } = await supabase
      .from("company_settings")
      .select("proposal_default_validity_days")
      .eq("company_id", session.company_id!)
      .maybeSingle();
    const v = (data as { proposal_default_validity_days: number | null } | null)
      ?.proposal_default_validity_days;
    if (typeof v === "number" && v > 0) days = v;
  } catch {
    /* migración no aplicada todavía → default 30 */
  }
  return { default_validity_days: days };
}

export async function updateProposalsConfigAction(input: unknown) {
  const session = await ensureAdmin();
  const parsed = parseOrFriendly(schema, input, "Configuración propuestas");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: existing } = await supabase
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("company_settings")
      .update({ proposal_default_validity_days: parsed.default_validity_days })
      .eq("company_id", session.company_id!);
  } else {
    await supabase.from("company_settings").insert({
      company_id: session.company_id!,
      proposal_default_validity_days: parsed.default_validity_days,
    });
  }
  revalidatePath("/configuracion/propuestas");
}

/** Versión pública (sin role check) usada al crear propuesta. */
export async function getDefaultProposalValidityDays(): Promise<number> {
  const session = await requireSession();
  if (!session.company_id) return 30;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  try {
    const { data } = await supabase
      .from("company_settings")
      .select("proposal_default_validity_days")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const v = (data as { proposal_default_validity_days: number | null } | null)
      ?.proposal_default_validity_days;
    if (typeof v === "number" && v > 0) return v;
  } catch {
    /* default fallback */
  }
  return 30;
}
