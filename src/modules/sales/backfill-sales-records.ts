"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { reconcileSalesRecordsForCompany } from "./reconcile";

/**
 * Regenera sales_records a partir de los contratos firmados de la empresa.
 *
 * Botón "Recalcular ventas del mes" en /configuracion/objetivos. Ahora el
 * cron diario hace el mismo trabajo automáticamente en modo NO-force (solo
 * inserta donde falta), así que este botón es un "force-recompute":
 * borra los previos y los reinserta. Útil si tras cambios manuales en
 * contratos hay que poner el contador de objetivos en sync.
 *
 *  - Solo admin (company_admin / superadmin) puede ejecutarlo.
 *  - Es idempotente: borra los sales_records previos del contrato antes
 *    de reinsertar (no duplica).
 *  - El periodo se calcula con `signed_at`, no con la fecha actual, para
 *    que los objetivos del mes correcto reciban el cómputo.
 */
export async function backfillSalesRecordsAction(): Promise<{
  contracts_processed: number;
  records_inserted: number;
  errors: string[];
}> {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede ejecutar el backfill.");
  }
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const r = await reconcileSalesRecordsForCompany(admin, session.company_id, {
    force: true,
  });

  revalidatePath("/dashboard");
  revalidatePath("/objetivos");
  revalidatePath("/configuracion/objetivos");

  return {
    contracts_processed: r.contracts_scanned,
    records_inserted: r.records_inserted,
    errors: r.errors,
  };
}
