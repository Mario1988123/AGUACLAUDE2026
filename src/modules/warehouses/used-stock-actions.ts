"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface NonNewStockRow {
  id: string;                 // warehouse_stock id
  product_id: string;
  product_name: string;
  state: "new" | "used" | "damaged" | "refurbished" | "reserved_trial";
  quantity: number;
}

/**
 * Devuelve líneas de warehouse_stock con state != 'new' para un almacén.
 * Pensado para gestionar equipos usados/dañados/reacondicionados.
 */
export async function listNonNewStock(
  warehouseId: string,
): Promise<NonNewStockRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: rows } = await supabase
    .from("warehouse_stock")
    .select("id, product_id, state, quantity")
    .eq("warehouse_id", warehouseId)
    .neq("state", "new")
    .gt("quantity", 0);
  type R = {
    id: string;
    product_id: string;
    state: NonNewStockRow["state"];
    quantity: number;
  };
  const list = (rows ?? []) as R[];
  if (list.length === 0) return [];
  const productIds = Array.from(new Set(list.map((r) => r.product_id)));
  const { data: prods } = await supabase
    .from("products")
    .select("id, name")
    .in("id", productIds);
  const nameMap = new Map(
    ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  return list.map((r) => ({
    ...r,
    product_name: nameMap.get(r.product_id) ?? "?",
  }));
}
