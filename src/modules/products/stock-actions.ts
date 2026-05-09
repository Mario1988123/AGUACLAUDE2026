"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface SalesHistoryPoint {
  date: string; // YYYY-MM-DD
  outbound: number;
}

/**
 * Devuelve las salidas (instalaciones, pruebas, mantenimientos) de un
 * producto agrupadas por día durante los últimos N días. Usado en la ficha
 * de producto para detectar el ritmo de consumo.
 */
export async function getProductSalesHistory(
  productId: string,
  days: number = 90,
): Promise<SalesHistoryPoint[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const { data: movs } = await supabase
    .from("stock_movements")
    .select("performed_at, quantity, movement_type")
    .eq("product_id", productId)
    .in("movement_type", ["outbound_install", "outbound_trial", "outbound_maintenance"])
    .gte("performed_at", from.toISOString())
    .order("performed_at");
  type M = { performed_at: string; quantity: number; movement_type: string };
  const list = (movs ?? []) as M[];

  const byDay = new Map<string, number>();
  for (const m of list) {
    const d = new Date(m.performed_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay.set(key, (byDay.get(key) ?? 0) + m.quantity);
  }
  return Array.from(byDay.entries())
    .map(([date, outbound]) => ({ date, outbound }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Resumen de stock global del producto (suma de todos los almacenes) +
 * desglose por almacén. Usado en la ficha del producto.
 */
export interface ProductStockSummary {
  total: number;
  by_warehouse: Array<{
    warehouse_id: string;
    warehouse_name: string;
    warehouse_kind: string;
    quantity: number;
  }>;
}

export async function getProductStockSummary(
  productId: string,
): Promise<ProductStockSummary> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: stocks } = await supabase
    .from("warehouse_stock")
    .select("warehouse_id, quantity")
    .eq("product_id", productId);
  type S = { warehouse_id: string; quantity: number };
  const list = (stocks ?? []) as S[];

  const totals = new Map<string, number>();
  for (const s of list) {
    totals.set(s.warehouse_id, (totals.get(s.warehouse_id) ?? 0) + s.quantity);
  }
  const ids = Array.from(totals.keys());
  if (ids.length === 0) return { total: 0, by_warehouse: [] };

  const { data: whs } = await supabase
    .from("warehouses")
    .select("id, name, kind")
    .in("id", ids);
  const whMap = new Map(
    ((whs ?? []) as Array<{ id: string; name: string; kind: string }>).map((w) => [
      w.id,
      w,
    ]),
  );
  const by_warehouse = ids.map((wid) => {
    const w = whMap.get(wid);
    return {
      warehouse_id: wid,
      warehouse_name: w?.name ?? wid.slice(0, 8),
      warehouse_kind: w?.kind ?? "?",
      quantity: totals.get(wid) ?? 0,
    };
  });
  const total = by_warehouse.reduce((a, b) => a + b.quantity, 0);
  return { total, by_warehouse };
}
