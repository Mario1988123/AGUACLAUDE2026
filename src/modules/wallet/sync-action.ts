"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { reconcileContractPaymentsForCompany } from "./reconcile-payments";

/**
 * Botón "Sincronizar pagos" — fuerza el reconcile inmediato para la
 * empresa actual. Útil cuando algún cobro quedó desincronizado y el
 * admin no quiere esperar al cron del día siguiente.
 *
 * Idempotente y seguro de repetir.
 */
export async function syncContractPaymentsAction(): Promise<
  | {
      ok: true;
      wallet_links_repaired: number;
      payments_propagated: number;
      errors: string[];
    }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin o director comercial",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await reconcileContractPaymentsForCompany(admin, session.company_id);
    revalidatePath("/contratos/alquileres");
    revalidatePath("/wallet");
    return {
      ok: true,
      wallet_links_repaired: r.wallet_links_repaired,
      payments_propagated: r.payments_propagated,
      errors: r.errors,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
