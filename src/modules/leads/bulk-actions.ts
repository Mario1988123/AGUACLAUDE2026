"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

const reassignSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().nullable(),
});

/**
 * Reasigna múltiples leads a un comercial. Si user_id es null, los desasigna.
 * Solo admin/director.
 */
export async function bulkReassignLeadsAction(input: unknown): Promise<number> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo admin o director");

  const parsed = reassignSchema.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const update: Record<string, unknown> = {
    assigned_user_id: parsed.user_id,
    assigned_at: parsed.user_id ? new Date().toISOString() : null,
    assigned_by: session.user_id,
  };

  const { error, count } = await supabase
    .from("leads")
    .update(update)
    .in("id", parsed.lead_ids)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);

  // Eventos timeline (uno por lead)
  await supabase.from("events").insert(
    parsed.lead_ids.map((id) => ({
      company_id: session.company_id,
      subject_type: "lead",
      subject_id: id,
      kind: "lead.reassigned",
      payload: { to_user_id: parsed.user_id },
      actor_user_id: session.user_id,
    })),
  );

  revalidatePath("/leads");
  return count ?? parsed.lead_ids.length;
}
