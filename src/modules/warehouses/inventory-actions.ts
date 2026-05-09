"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureCanManage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director") &&
    !session.roles.includes("installer")
  ) {
    throw new Error("Sin permiso para mover stock");
  }
  return session;
}

export interface WarehouseDetail {
  id: string;
  name: string;
  kind: "main" | "secondary" | "vehicle" | "external_supplier";
  vehicle_plate: string | null;
  assigned_user_id: string | null;
  notes: string | null;
  is_active: boolean;
}

export async function getWarehouse(id: string): Promise<WarehouseDetail | null> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("warehouses")
    .select("id, name, kind, vehicle_plate, assigned_user_id, notes, is_active")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as WarehouseDetail | null) ?? null;
}

/**
 * Añade stock (entrada de proveedor o creación inicial). Si el producto ya
 * existe en el almacén, suma la cantidad. Genera stock_movement de tipo
 * `inbound` con la cantidad añadida.
 */
export async function addStockAction(input: {
  warehouse_id: string;
  product_id: string;
  quantity: number;
  notes?: string;
}): Promise<void> {
  const session = await ensureCanManage();
  if (input.quantity <= 0) throw new Error("Cantidad debe ser > 0");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: existing } = await admin
    .from("warehouse_stock")
    .select("id, quantity")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .eq("state", "new")
    .is("location_id", null)
    .maybeSingle();
  const row = existing as { id: string; quantity: number } | null;
  if (row) {
    await admin
      .from("warehouse_stock")
      .update({ quantity: row.quantity + input.quantity })
      .eq("id", row.id);
  } else {
    await admin.from("warehouse_stock").insert({
      company_id: session.company_id,
      warehouse_id: input.warehouse_id,
      product_id: input.product_id,
      quantity: input.quantity,
      state: "new",
    });
  }

  await admin.from("stock_movements").insert({
    company_id: session.company_id,
    product_id: input.product_id,
    warehouse_id: input.warehouse_id,
    movement_type: "inbound",
    quantity: input.quantity,
    state_after: "new",
    performed_by: session.user_id,
    notes: input.notes ?? null,
  });

  revalidatePath(`/almacenes/${input.warehouse_id}`);
  revalidatePath("/almacenes");
}

/**
 * Ajusta stock a una cantidad concreta (inventario). Genera movimiento
 * adjustment_plus o adjustment_minus con la diferencia.
 */
export async function setStockQuantityAction(input: {
  warehouse_id: string;
  product_id: string;
  new_quantity: number;
  notes?: string;
  reason?: string;
}): Promise<void> {
  const session = await ensureCanManage();
  if (input.new_quantity < 0) throw new Error("La cantidad no puede ser negativa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: existing } = await admin
    .from("warehouse_stock")
    .select("id, quantity")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .eq("state", "new")
    .is("location_id", null)
    .maybeSingle();
  const row = existing as { id: string; quantity: number } | null;
  const oldQty = row?.quantity ?? 0;
  const delta = input.new_quantity - oldQty;
  if (delta === 0) return;

  if (row) {
    await admin
      .from("warehouse_stock")
      .update({ quantity: input.new_quantity })
      .eq("id", row.id);
  } else if (input.new_quantity > 0) {
    await admin.from("warehouse_stock").insert({
      company_id: session.company_id,
      warehouse_id: input.warehouse_id,
      product_id: input.product_id,
      quantity: input.new_quantity,
      state: "new",
    });
  }

  await admin.from("stock_movements").insert({
    company_id: session.company_id,
    product_id: input.product_id,
    warehouse_id: input.warehouse_id,
    movement_type: delta > 0 ? "adjustment_plus" : "adjustment_minus",
    quantity: Math.abs(delta),
    state_after: "new",
    performed_by: session.user_id,
    notes: input.notes ?? `Inventario: ${oldQty} → ${input.new_quantity}`,
    reason: input.reason ?? null,
  });

  revalidatePath(`/almacenes/${input.warehouse_id}`);
  revalidatePath("/almacenes");
}

/**
 * Crea o actualiza el umbral de stock (min/max) para un producto en un
 * almacén concreto. Sobrescribe el stock_min global de products.
 */
export async function upsertStockThresholdAction(input: {
  warehouse_id: string;
  product_id: string;
  stock_min: number;
  stock_max: number | null;
}): Promise<void> {
  const session = await ensureCanManage();
  if (input.stock_min < 0) throw new Error("Mínimo no puede ser negativo");
  if (input.stock_max != null && input.stock_max < input.stock_min)
    throw new Error("Máximo debe ser mayor o igual que el mínimo");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: existing } = await admin
    .from("warehouse_stock_thresholds")
    .select("id")
    .eq("warehouse_id", input.warehouse_id)
    .eq("product_id", input.product_id)
    .maybeSingle();
  if (existing) {
    await admin
      .from("warehouse_stock_thresholds")
      .update({
        stock_min: input.stock_min,
        stock_max: input.stock_max,
      })
      .eq("id", (existing as { id: string }).id);
  } else {
    await admin.from("warehouse_stock_thresholds").insert({
      company_id: session.company_id,
      warehouse_id: input.warehouse_id,
      product_id: input.product_id,
      stock_min: input.stock_min,
      stock_max: input.stock_max,
    });
  }
  revalidatePath(`/almacenes/${input.warehouse_id}`);
}

export interface WarehouseThreshold {
  warehouse_id: string;
  product_id: string;
  stock_min: number;
  stock_max: number | null;
}

/**
 * Descarga rápida desde una furgoneta a otro almacén (típicamente principal).
 * Es un alias semántico de transferencia con notas claras.
 */
export async function unloadFromVanAction(input: {
  van_warehouse_id: string;
  destination_warehouse_id: string;
  product_id: string;
  quantity: number;
  notes?: string;
}): Promise<void> {
  // Reusamos la transferencia existente para no duplicar lógica.
  const { transferStockAction } = await import("./transfer-actions");
  await transferStockAction({
    from_warehouse_id: input.van_warehouse_id,
    to_warehouse_id: input.destination_warehouse_id,
    product_id: input.product_id,
    quantity: input.quantity,
    notes: input.notes ?? "Descarga de furgoneta",
  });
  revalidatePath(`/almacenes/${input.van_warehouse_id}`);
  revalidatePath(`/almacenes/${input.destination_warehouse_id}`);
}

export async function listThresholds(
  warehouseId: string,
): Promise<WarehouseThreshold[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("warehouse_stock_thresholds")
    .select("warehouse_id, product_id, stock_min, stock_max")
    .eq("warehouse_id", warehouseId);
  return (data ?? []) as WarehouseThreshold[];
}

export interface StockMovementRow {
  id: string;
  product_id: string;
  product_name: string;
  movement_type: string;
  quantity: number;
  performed_at: string;
  performed_by_name: string | null;
  destination_warehouse_id: string | null;
  destination_warehouse_name: string | null;
  notes: string | null;
  reason: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  purchase_id: string | null;
}

export async function listStockMovements(
  warehouseId: string,
  limit?: number,
): Promise<StockMovementRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("stock_movements")
    .select(
      "id, product_id, movement_type, quantity, performed_at, performed_by, destination_warehouse_id, notes, reason, contract_id, invoice_id, purchase_id",
    )
    .eq("warehouse_id", warehouseId)
    .order("performed_at", { ascending: false });
  if (typeof limit === "number" && limit > 0) q = q.limit(limit);
  const { data: movs } = await q;
  type M = {
    id: string;
    product_id: string;
    movement_type: string;
    quantity: number;
    performed_at: string;
    performed_by: string | null;
    destination_warehouse_id: string | null;
    notes: string | null;
    reason: string | null;
    contract_id: string | null;
    invoice_id: string | null;
    purchase_id: string | null;
  };
  const list = (movs ?? []) as M[];
  if (list.length === 0) return [];

  const productIds = Array.from(new Set(list.map((m) => m.product_id)));
  const userIds = Array.from(
    new Set(list.map((m) => m.performed_by).filter(Boolean) as string[]),
  );
  const whIds = Array.from(
    new Set(
      list.map((m) => m.destination_warehouse_id).filter(Boolean) as string[],
    ),
  );

  const [pRes, uRes, wRes] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] }),
    userIds.length > 0
      ? supabase.from("user_profiles").select("user_id, full_name").in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    whIds.length > 0
      ? supabase.from("warehouses").select("id, name").in("id", whIds)
      : Promise.resolve({ data: [] }),
  ]);
  const pMap = new Map(
    ((pRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const uMap = new Map(
    ((uRes.data ?? []) as Array<{ user_id: string; full_name: string | null }>).map(
      (u) => [u.user_id, u.full_name],
    ),
  );
  const wMap = new Map(
    ((wRes.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]),
  );

  return list.map((m) => ({
    id: m.id,
    product_id: m.product_id,
    product_name: pMap.get(m.product_id) ?? "?",
    movement_type: m.movement_type,
    quantity: m.quantity,
    performed_at: m.performed_at,
    performed_by_name: m.performed_by ? uMap.get(m.performed_by) ?? null : null,
    destination_warehouse_id: m.destination_warehouse_id,
    destination_warehouse_name: m.destination_warehouse_id
      ? wMap.get(m.destination_warehouse_id) ?? null
      : null,
    notes: m.notes,
    reason: m.reason,
    contract_id: m.contract_id,
    invoice_id: m.invoice_id,
    purchase_id: m.purchase_id,
  }));
}
