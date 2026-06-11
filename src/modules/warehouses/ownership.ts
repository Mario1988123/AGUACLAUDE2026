import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Verifica que un almacén pertenece a la empresa indicada. Lanza si no.
 *
 * POR QUÉ: las mutaciones de stock usan el admin client (salta RLS) y aceptan
 * `warehouse_id` del navegador. Sin esta comprobación, un usuario de la
 * empresa A podría escribir stock/movimientos/umbrales sobre almacenes de la
 * empresa B pasando su UUID. Llamar SIEMPRE antes de mutar por warehouse_id.
 */
export async function assertWarehouseCompany(
  warehouseId: string,
  companyId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("warehouses")
    .select("id")
    .eq("id", warehouseId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) {
    throw new Error("Almacén no encontrado o no pertenece a tu empresa");
  }
}
