"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { composeLocationCode } from "./location-utils";

async function ensureCanManage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    throw new Error("Solo admin o director técnico puede gestionar ubicaciones");
  }
  return session;
}

export interface WarehouseLocation {
  id: string;
  warehouse_id: string;
  shelf: string | null;
  level: string | null;
  slot: string | null;
  code: string;
  description: string | null;
  is_active: boolean;
}

export async function listWarehouseLocations(
  warehouseId: string,
): Promise<WarehouseLocation[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("warehouse_locations")
    .select("id, warehouse_id, shelf, level, slot, code, description, is_active")
    .eq("warehouse_id", warehouseId)
    .order("shelf")
    .order("level")
    .order("slot");
  return ((data ?? []) as WarehouseLocation[]).map((l) => ({
    ...l,
    code: l.code ?? composeLocationCode(l.shelf, l.level, l.slot),
  }));
}

export async function upsertLocationAction(input: {
  id?: string;
  warehouse_id: string;
  shelf?: string | null;
  level?: string | null;
  slot?: string | null;
  description?: string | null;
}): Promise<void> {
  const session = await ensureCanManage();
  const code = composeLocationCode(input.shelf, input.level, input.slot);
  if (!code) throw new Error("Indica al menos estantería, altura o hueco");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = {
    company_id: session.company_id,
    warehouse_id: input.warehouse_id,
    shelf: input.shelf?.trim() || null,
    level: input.level?.trim() || null,
    slot: input.slot?.trim() || null,
    code,
    description: input.description?.trim() || null,
  };
  if (input.id) {
    const { error } = await admin
      .from("warehouse_locations")
      .update(payload)
      .eq("id", input.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("warehouse_locations").insert(payload);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/almacenes/${input.warehouse_id}`);
}

export async function deleteLocationAction(
  locationId: string,
  warehouseId: string,
): Promise<void> {
  await ensureCanManage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // No bloqueamos: warehouse_stock.location_id ON DELETE SET NULL.
  const { error } = await admin
    .from("warehouse_locations")
    .delete()
    .eq("id", locationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/almacenes/${warehouseId}`);
}

/**
 * Asigna o cambia la ubicación de TODO el stock de un producto en un almacén.
 * Como `warehouse_stock` tiene unique(warehouse_id, product_id, state, location_id),
 * si el producto ya estaba en otra ubicación, fusionamos cantidades.
 */
export async function assignStockLocationAction(input: {
  warehouse_id: string;
  product_id: string;
  location_id: string | null;
}): Promise<void> {
  await ensureCanManage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Solo state='new' por simplicidad (lo que usamos en toda la app).
  const { data: rows } = await admin
    .from("warehouse_stock")
    .select("id, quantity, location_id")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .eq("state", "new");
  const list = (rows ?? []) as Array<{
    id: string;
    quantity: number;
    location_id: string | null;
  }>;
  if (list.length === 0) {
    // No hay stock todavía, no hay nada que mover.
    return;
  }
  // Sumar todo el stock actual del producto en este almacén.
  const total = list.reduce((s, r) => s + r.quantity, 0);
  // Borrar todas las filas y crear una sola con la nueva ubicación.
  await admin
    .from("warehouse_stock")
    .delete()
    .in(
      "id",
      list.map((r) => r.id),
    );
  await admin.from("warehouse_stock").insert({
    company_id: (await requireSession()).company_id,
    warehouse_id: input.warehouse_id,
    product_id: input.product_id,
    quantity: total,
    state: "new",
    location_id: input.location_id,
  });
  revalidatePath(`/almacenes/${input.warehouse_id}`);
}

/**
 * Devuelve la ubicación asignada a cada producto que tiene stock en el almacén.
 * Si un producto está repartido en varias ubicaciones (estado 'new'), devuelve
 * la primera por orden de location.code; el flag `multiple` lo marca.
 */
export interface ProductLocation {
  product_id: string;
  location_id: string | null;
  location_code: string | null;
  quantity: number;
  multiple: boolean;
}

export async function listProductLocations(
  warehouseId: string,
): Promise<ProductLocation[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: stocks } = await supabase
    .from("warehouse_stock")
    .select("product_id, quantity, location_id")
    .eq("warehouse_id", warehouseId)
    .eq("state", "new");
  type S = { product_id: string; quantity: number; location_id: string | null };
  const list = (stocks ?? []) as S[];
  if (list.length === 0) return [];

  const locIds = Array.from(
    new Set(list.map((s) => s.location_id).filter(Boolean) as string[]),
  );
  let locMap = new Map<string, string>();
  if (locIds.length > 0) {
    const { data: locs } = await supabase
      .from("warehouse_locations")
      .select("id, code, shelf, level, slot")
      .in("id", locIds);
    locMap = new Map(
      ((locs ?? []) as Array<{
        id: string;
        code: string | null;
        shelf: string | null;
        level: string | null;
        slot: string | null;
      }>).map((l) => [
        l.id,
        l.code ?? composeLocationCode(l.shelf, l.level, l.slot),
      ]),
    );
  }

  // Agrupar por producto
  const byProduct = new Map<string, S[]>();
  for (const s of list) {
    if (!byProduct.has(s.product_id)) byProduct.set(s.product_id, []);
    byProduct.get(s.product_id)!.push(s);
  }
  const out: ProductLocation[] = [];
  for (const [pid, rows] of byProduct.entries()) {
    if (rows.length === 0) continue;
    const distinctLocs = new Set(rows.map((r) => r.location_id));
    const total = rows.reduce((s, r) => s + r.quantity, 0);
    const first = rows[0]!;
    out.push({
      product_id: pid,
      location_id: first.location_id,
      location_code: first.location_id ? locMap.get(first.location_id) ?? null : null,
      quantity: total,
      multiple: distinctLocs.size > 1,
    });
  }
  return out;
}

// =================== Safe wrappers ===================

export async function upsertLocationSafeAction(input: {
  id?: string;
  warehouse_id: string;
  shelf?: string | null;
  level?: string | null;
  slot?: string | null;
  description?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertLocationAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteLocationSafeAction(
  locationId: string,
  warehouseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteLocationAction(locationId, warehouseId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function assignStockLocationSafeAction(input: {
  warehouse_id: string;
  product_id: string;
  location_id: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assignStockLocationAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
