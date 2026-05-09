"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface WarehouseStockSummary {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_kind: string;
  total_units: number;
  distinct_products: number;
  low_stock_alerts: number;
}

/**
 * Devuelve resumen de stock por almacén: total unidades, productos distintos
 * y nº de productos bajo stock_min.
 */
export async function listWarehouseStockSummary(): Promise<WarehouseStockSummary[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name, kind")
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .order("kind")
    .order("name");
  const whs = (warehouses ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
  }>;
  if (whs.length === 0) return [];

  const { data: stocks } = await supabase
    .from("warehouse_stock")
    .select("warehouse_id, product_id, quantity")
    .in(
      "warehouse_id",
      whs.map((w) => w.id),
    );
  type S = { warehouse_id: string; product_id: string; quantity: number };
  const stockList = (stocks ?? []) as S[];

  const productIds = Array.from(new Set(stockList.map((s) => s.product_id)));
  const minMap = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, stock_min, stock_managed")
      .in("id", productIds);
    for (const p of (prods ?? []) as Array<{
      id: string;
      stock_min: number;
      stock_managed: boolean;
    }>) {
      if (p.stock_managed) minMap.set(p.id, p.stock_min);
    }
  }

  return whs.map((w) => {
    const wsStocks = stockList.filter((s) => s.warehouse_id === w.id);
    const totalsByProduct = new Map<string, number>();
    for (const s of wsStocks) {
      totalsByProduct.set(s.product_id, (totalsByProduct.get(s.product_id) ?? 0) + s.quantity);
    }
    let alerts = 0;
    for (const [pid, qty] of totalsByProduct) {
      const min = minMap.get(pid);
      if (min !== undefined && qty <= min) alerts += 1;
    }
    return {
      warehouse_id: w.id,
      warehouse_name: w.name,
      warehouse_kind: w.kind,
      total_units: Array.from(totalsByProduct.values()).reduce((a, b) => a + b, 0),
      distinct_products: totalsByProduct.size,
      low_stock_alerts: alerts,
    };
  });
}

export interface WarehouseStockDetail {
  product_id: string;
  product_name: string;
  total: number;
  stock_min: number | null;
  stock_max: number | null;
  is_low: boolean;
  is_over: boolean;
}

export async function getWarehouseStockDetail(
  warehouseId: string,
): Promise<WarehouseStockDetail[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: stocks } = await supabase
    .from("warehouse_stock")
    .select("product_id, quantity")
    .eq("warehouse_id", warehouseId);
  type S = { product_id: string; quantity: number };
  const list = (stocks ?? []) as S[];

  // Cargamos también los thresholds del almacén (override min/max)
  // Defensivo si la migración aún no se aplicó
  let thresholds: Array<{ product_id: string; stock_min: number; stock_max: number | null }> = [];
  try {
    const { data: th } = await supabase
      .from("warehouse_stock_thresholds")
      .select("product_id, stock_min, stock_max")
      .eq("warehouse_id", warehouseId);
    thresholds = (th ?? []) as typeof thresholds;
  } catch {
    /* tabla aún no migrada */
  }
  const thMap = new Map(thresholds.map((t) => [t.product_id, t]));

  if (list.length === 0) return [];

  const totals = new Map<string, number>();
  for (const s of list) {
    totals.set(s.product_id, (totals.get(s.product_id) ?? 0) + s.quantity);
  }
  const ids = Array.from(totals.keys());
  let prodCols = "id, name, stock_min, stock_managed, stock_max";
  let prods: Array<{
    id: string;
    name: string;
    stock_min: number;
    stock_managed: boolean;
    stock_max: number | null;
  }> = [];
  try {
    const { data, error } = await supabase
      .from("products")
      .select(prodCols)
      .in("id", ids);
    if (error && /stock_max/i.test(error.message ?? "")) throw error;
    prods = (data ?? []) as typeof prods;
  } catch {
    prodCols = "id, name, stock_min, stock_managed";
    const { data } = await supabase
      .from("products")
      .select(prodCols)
      .in("id", ids);
    prods = ((data ?? []) as Array<{
      id: string;
      name: string;
      stock_min: number;
      stock_managed: boolean;
    }>).map((p) => ({ ...p, stock_max: null }));
  }
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  return ids
    .map((pid) => {
      const p = prodMap.get(pid);
      const total = totals.get(pid) ?? 0;
      const th = thMap.get(pid);
      // El threshold por almacén tiene prioridad. Si no hay, usamos products.stock_min (si stock_managed).
      const min = th
        ? th.stock_min
        : p?.stock_managed
          ? p.stock_min
          : null;
      const max = th ? th.stock_max : p?.stock_max ?? null;
      return {
        product_id: pid,
        product_name: p?.name ?? pid.slice(0, 8),
        total,
        stock_min: min,
        stock_max: max,
        is_low: min !== null && total <= min,
        is_over: max !== null && total > max,
      };
    })
    .sort((a, b) => a.product_name.localeCompare(b.product_name));
}
