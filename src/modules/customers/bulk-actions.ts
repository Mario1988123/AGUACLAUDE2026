"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const reassignSchema = z.object({
  customer_ids: z.array(z.string().uuid()).min(1).max(200),
  user_id: z.string().uuid().nullable(),
});

/**
 * Reasigna múltiples clientes a un comercial. Solo admin/director.
 */
export async function bulkReassignCustomersAction(input: unknown): Promise<number> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo admin o director");

  const parsed = parseOrFriendly(reassignSchema, input, "Reasignar clientes");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const update: Record<string, unknown> = {
    assigned_user_id: parsed.user_id,
    assigned_at: parsed.user_id ? new Date().toISOString() : null,
  };

  await supabase
    .from("customers")
    .update(update)
    .in("id", parsed.customer_ids)
    .eq("company_id", session.company_id)
    .is("deleted_at", null);

  await supabase.from("events").insert(
    parsed.customer_ids.map((id) => ({
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: id,
      kind: "customer.reassigned",
      payload: { to_user_id: parsed.user_id },
      actor_user_id: session.user_id,
    })),
  );

  revalidatePath("/clientes");
  return parsed.customer_ids.length;
}
