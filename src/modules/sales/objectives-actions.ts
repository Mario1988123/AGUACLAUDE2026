"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const objectiveSchema = z.object({
  id: z.string().uuid().optional(),
  period_year: z.coerce.number().int().min(2020).max(2100),
  period_month: z.coerce.number().int().min(1).max(12),
  scope_type: z.enum(["department", "user"]),
  scope_department: z.enum(["tech", "sales", "tmk"]).optional().nullable(),
  scope_user_id: z.string().uuid().optional().nullable(),
  metric_kind: z.enum(["sales", "contracts", "installations", "recoveries"]).default("sales"),
  target_amount_cents: z.coerce.number().int().min(0).optional().nullable(),
  target_units: z.coerce.number().int().min(0).optional().nullable(),
  parent_objective_id: z.string().uuid().optional().nullable(),
});

async function ensureCanSetObjectives() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("telemarketing_director")
  )
    throw new Error("Solo admin/director");
  return session;
}

export async function upsertObjectiveAction(input: unknown) {
  const session = await ensureCanSetObjectives();
  const parsed = parseOrFriendly(objectiveSchema, input, "Objetivo ventas");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    company_id: session.company_id,
    period_year: parsed.period_year,
    period_month: parsed.period_month,
    scope_type: parsed.scope_type,
    scope_department:
      parsed.scope_type === "department" ? (parsed.scope_department ?? null) : null,
    scope_user_id: parsed.scope_type === "user" ? (parsed.scope_user_id ?? null) : null,
    parent_objective_id: parsed.parent_objective_id ?? null,
    metric_kind: parsed.metric_kind,
    target_amount_cents: parsed.target_amount_cents ?? null,
    target_units: parsed.target_units ?? null,
    set_by_user_id: session.user_id,
  };
  if (parsed.id) {
    await supabase.from("monthly_objectives").update(payload).eq("id", parsed.id);
  } else {
    await supabase.from("monthly_objectives").insert(payload);
  }
  revalidatePath("/configuracion/objetivos");
  revalidatePath("/ventas");
}

export async function deleteObjectiveAction(id: string) {
  await ensureCanSetObjectives();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("monthly_objectives").delete().eq("id", id);
  revalidatePath("/configuracion/objetivos");
  revalidatePath("/ventas");
}
