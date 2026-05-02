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
  is_low: boolean;
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
  if (list.length === 0) return [];

  const totals = new Map<string, number>();
  for (const s of list) {
    totals.set(s.product_id, (totals.get(s.product_id) ?? 0) + s.quantity);
  }
  const ids = Array.from(totals.keys());
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, stock_min, stock_managed")
    .in("id", ids);
  const prodMap = new Map(
    ((prods ?? []) as Array<{
      id: string;
      name: string;
      stock_min: number;
      stock_managed: boolean;
    }>).map((p) => [p.id, p]),
  );

  return ids
    .map((pid) => {
      const p = prodMap.get(pid);
      const total = totals.get(pid) ?? 0;
      const min = p?.stock_managed ? p.stock_min : null;
      return {
        product_id: pid,
        product_name: p?.name ?? pid.slice(0, 8),
        total,
        stock_min: min,
        is_low: min !== null && total <= min,
      };
    })
    .sort((a, b) => a.product_name.localeCompare(b.product_name));
}
