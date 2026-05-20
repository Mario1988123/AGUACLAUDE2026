"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Marca varios contratos en bloque como "active" desde "signed" (ya
 * tienen firma + IBAN). Solo admin / dir comercial.
 *
 * Por seguridad NO promueve contratos en `pending_data` o `draft`.
 */
export async function bulkActivateContractsAction(
  contractIds: string[],
): Promise<
  | { ok: true; activated: number; skipped: number }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("commercial_director")
    ) {
      return {
        ok: false,
        error: "Solo admin o director comercial puede activar contratos en lote",
      };
    }
    if (contractIds.length === 0) {
      return { ok: false, error: "Selecciona al menos un contrato" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: updated, error } = await admin
      .from("contracts")
      .update({ status: "active" })
      .in("id", contractIds)
      .eq("company_id", session.company_id)
      .eq("status", "signed")
      .select("id");
    if (error) return { ok: false, error: error.message };
    const activated = ((updated ?? []) as Array<{ id: string }>).length;
    const skipped = contractIds.length - activated;

    // Log de eventos
    for (const r of (updated ?? []) as Array<{ id: string }>) {
      try {
        await admin.from("events").insert({
          company_id: session.company_id,
          subject_type: "contract",
          subject_id: r.id,
          kind: "contract.activated",
          payload: { bulk: true },
          actor_user_id: session.user_id,
        });
      } catch {
        /* */
      }
    }

    revalidatePath("/contratos");
    return { ok: true, activated, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
