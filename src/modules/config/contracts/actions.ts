"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface ClauseTemplate {
  id: string;
  key: string;
  title: string;
  body_template: string;
  display_order: number;
  is_required: boolean;
  is_active: boolean;
}

const clauseUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().min(2),
  title: z.string().min(2),
  body_template: z.string().min(5),
  display_order: z.coerce.number().int().min(0).default(0),
  is_required: z.boolean().default(false),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function listClauseTemplates(): Promise<ClauseTemplate[]> {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("contract_clause_templates")
    .select("id, key, title, body_template, display_order, is_required, is_active")
    .eq("is_active", true)
    .order("display_order");
  return (data ?? []) as ClauseTemplate[];
}

export async function upsertClauseTemplateAction(input: unknown) {
  const session = await ensureAdmin();
  const parsed = clauseUpsertSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    company_id: session.company_id,
    key: parsed.key,
    title: parsed.title,
    body_template: parsed.body_template,
    display_order: parsed.display_order,
    is_required: parsed.is_required,
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
