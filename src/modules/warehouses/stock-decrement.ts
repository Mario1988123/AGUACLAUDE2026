"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

interface DecrementInput {
  company_id: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  movement_type:
    | "outbound_install"
    | "outbound_trial"
    | "outbound_maintenance"
    | "transfer_out"
    | "adjustment_minus";
  installation_id?: string | null;
  free_trial_id?: string | null;
  maintenance_id?: string | null;
  performed_by?: string | null;
  notes?: string | null;
}

/**
 * Decrementa stock de un (warehouse, product) y registra el stock_movement.
 * Si la suma de cantidades por estado en ese warehouse es < quantity, decrementa
 * lo que pueda y registra el movimiento por la cantidad real movida.
 *
 * Devuelve la cantidad realmente movida.
 */
export async function decrementStock(input: DecrementInput): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: rows } = await admin
    .from("warehouse_stock")
    .select("id, quantity, state, location_id")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .order("quantity", { ascending: false });
  type Row = { id: string; quantity: number; state: string; location_id: string | null };
  const list = (rows ?? []) as Row[];
  let remaining = input.quantity;
  let moved = 0;
  for (const r of list) {
    if (remaining <= 0) break;
    const take = Math.min(r.quantity, remaining);
    if (take <= 0) continue;
    await admin
      .from("warehouse_stock")
      .update({ quantity: r.quantity - take, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    remaining -= take;
    moved += take;
  }
  if (moved > 0) {
    await admin.from("stock_movements").insert({
      company_id: input.company_id,
      product_id: input.product_id,
      warehouse_id: input.warehouse_id,
      movement_type: input.movement_type,
      quantity: moved,
      installation_id: input.installation_id ?? null,
      free_trial_id: input.free_trial_id ?? null,
      maintenance_id: input.maintenance_id ?? null,
      performed_by: input.performed_by ?? null,
      notes: input.notes ?? null,
    });
  }
  return moved;
}

/**
 * Procesa todos los items instalados, descontando del source_warehouse_id de la
 * instalación. Si no hay warehouse, no hace nada (no es error).
 */
export async function decrementStockForInstallation(installationId: string): Promise<{
  moved_total: number;
  items: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, source_warehouse_id, installer_user_id")
    .eq("id", installationId)
    .single();
  if (!inst) return { moved_total: 0, items: 0 };
  const i = inst as {
    id: string;
    company_id: string;
    source_warehouse_id: string | null;
    installer_user_id: string | null;
  };
  if (!i.source_warehouse_id) return { moved_total: 0, items: 0 };

  const { data: items } = await admin
    .from("installation_items")
    .select("product_id, quantity")
    .eq("installation_id", installationId);
  const list = (items ?? []) as Array<{ product_id: string; quantity: number }>;
  if (list.length === 0) return { moved_total: 0, items: 0 };

  let total = 0;
  for (const it of list) {
    const moved = await decrementStock({
      company_id: i.company_id,
      warehouse_id: i.source_warehouse_id,
      product_id: it.product_id,
      quantity: it.quantity,
      movement_type: "outbound_install",
      installation_id: i.id,
      performed_by: i.installer_user_id,
      notes: "Auto-decrement on installation completion",
    });
    total += moved;
  }
  return { moved_total: total, items: list.length };
}
