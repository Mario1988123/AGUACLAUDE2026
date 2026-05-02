"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type ClausePlanType = "cash" | "rental" | "renting";

export interface ClauseTemplate {
  id: string;
  plan_type: ClausePlanType;
  title: string;
  body: string;
  display_order: number;
  is_active: boolean;
}

const clauseUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  plan_type: z.enum(["cash", "rental", "renting"]),
  title: z.string().min(2),
  body: z.string().min(5),
  display_order: z.coerce.number().int().min(0).default(0),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Lista cláusulas activas. Si la empresa no tiene ninguna, llama al RPC seed
 * para sembrar los defaults (cash + rental + renting) y vuelve a leer.
 */
export async function listClauseTemplates(): Promise<ClauseTemplate[]> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let { data } = await supabase
    .from("contract_clause_templates")
    .select("id, plan_type, title, body, display_order, is_active")
    .eq("company_id", session.company_id)
    .order("plan_type")
    .order("display_order");
  if (!data || (data as Array<unknown>).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.rpc("seed_default_clauses", { p_company_id: session.company_id });
    const r = await supabase
      .from("contract_clause_templates")
      .select("id, plan_type, title, body, display_order, is_active")
      .eq("company_id", session.company_id)
      .order("plan_type")
      .order("display_order");
    data = r.data;
  }
  return (data ?? []) as ClauseTemplate[];
}

export async function upsertClauseTemplateAction(input: unknown) {
  const session = await ensureAdmin();
  const parsed = clauseUpsertSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    company_id: session.company_id,
    plan_type: parsed.plan_type,
    title: parsed.title,
    body: parsed.body,
    display_order: parsed.display_order,
    is_active: true,
  };
  if (parsed.id) {
    const { error } = await supabase
      .from("contract_clause_templates")
      .update(payload)
      .eq("id", parsed.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("contract_clause_templates").insert(payload);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/configuracion/contratos");
}

export async function deleteClauseTemplateAction(id: string) {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("contract_clause_templates").update({ is_active: false }).eq("id", id);
  revalidatePath("/configuracion/contratos");
}

export async function toggleClauseActiveAction(id: string, isActive: boolean) {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("contract_clause_templates")
    .update({ is_active: isActive })
    .eq("id", id);
  revalidatePath("/configuracion/contratos");
}
