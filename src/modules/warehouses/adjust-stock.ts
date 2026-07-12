import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Wrapper de la RPC atómica `adjust_stock_batch` (migración 20260709120000).
 *
 * NO es "use server": es un helper interno llamado por otras server actions
 * (transferStockAction, decrementStock, etc.). Queda server-only porque importa
 * el admin client. Centraliza la mutación de stock: una sola transacción en la
 * BD, con bloqueo de fila, en vez del patrón select->update->insert que evaporaba
 * stock y sufría lost updates.
 *
 * El REPARTO por ubicaciones (varias celdas de un mismo producto/almacén) lo arma
 * el llamador pasando varias entradas en `adjustments`: todas se aplican en la
 * misma transacción.
 */

export type StockState = "new" | "used" | "damaged" | "refurbished";

export interface StockAdjustment {
  warehouse_id: string;
  product_id: string;
  /** Estado del stock. Por defecto 'new' (el único vendible). */
  state?: StockState;
  /** Ubicación concreta dentro del almacén. null = montón general. */
  location_id?: string | null;
  /** Cantidad: > 0 entra, < 0 sale. */
  delta: number;
  movement_type: string;
  destination_warehouse_id?: string | null;
  installation_id?: string | null;
  free_trial_id?: string | null;
  maintenance_id?: string | null;
  loading_request_id?: string | null;
  contract_id?: string | null;
  lot_id?: string | null;
  purchase_id?: string | null;
  reason?: string | null;
  notes?: string | null;
  /** En decrementos: si no cabe, coge lo disponible en vez de fallar. */
  allow_partial?: boolean;
}

export interface StockAdjustmentResult {
  warehouse_id: string;
  product_id: string;
  requested: number;
  applied: number;
}

/** Se cumple cuando la RPC falla por stock insuficiente en modo estricto. */
export function isInsufficientStockError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /INSUFFICIENT_STOCK/i.test(msg);
}

/**
 * La RPC NO existe todavía (migración sin aplicar). SOLO en este caso es seguro
 * hacer fallback al camino clásico. Cualquier OTRO error (transporte, timeout,
 * reset de conexión) NO debe reintentar por legacy: la RPC pudo haber commiteado
 * y reejecutar el camino no atómico DUPLICARÍA el stock (auditoría Fable C3).
 */
export function isFunctionMissingError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "PGRST202" || err?.code === "42883") return true;
  const msg = (err?.message ?? "").toLowerCase();
  return /could not find the function|does not exist|schema cache/.test(msg);
}

/**
 * Aplica N ajustes de stock de forma ATÓMICA. Lanza si la operación no cabe
 * (INSUFFICIENT_STOCK, en ajustes estrictos) o si la RPC no está disponible
 * (migración sin aplicar) — el llamador decide entre propagar o hacer fallback.
 */
export async function adjustStockBatch(
  companyId: string,
  performedBy: string | null,
  adjustments: StockAdjustment[],
): Promise<StockAdjustmentResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin.rpc("adjust_stock_batch", {
    p_company_id: companyId,
    p_performed_by: performedBy,
    p_adjustments: adjustments,
  });
  if (error) {
    // Preservamos el code de PostgREST/Postgres para poder distinguir
    // "función inexistente" (fallback seguro) de un error real (no reintentar).
    const err = new Error(error.message ?? "adjust_stock_batch error") as Error & {
      code?: string;
    };
    err.code = error.code;
    throw err;
  }
  return (data ?? []) as StockAdjustmentResult[];
}
