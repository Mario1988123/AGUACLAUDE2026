"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const warehouseUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2),
  kind: z.enum(["main", "secondary", "vehicle", "external_supplier"]),
  vehicle_plate: z.string().optional().default(""),
  assigned_user_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().default(""),
});

async function ensureCanManageWarehouses() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  )
    throw new Error("Solo admin/director técnico");
  return session;
}

export async function upsertWarehouseAction(input: unknown) {
  const session = await ensureCanManageWarehouses();
  const parsed = parseOrFriendly(warehouseUpsertSchema, input, "Almacén");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    company_id: session.company_id,
    name: parsed.name,
    kind: parsed.kind,
    vehicle_plate: parsed.vehicle_plate || null,
    assigned_user_id: parsed.assigned_user_id || null,
    notes: parsed.notes || null,
    is_active: true,
  };
  if (parsed.id) {
    const { error } = await supabase.from("warehouses").update(payload).eq("id", parsed.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("warehouses").insert(payload);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/almacenes");
}

export async function deleteWarehouseAction(id: string) {
  await ensureCanManageWarehouses();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("warehouses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/almacenes");
}

export async function listStockByWarehouse(warehouseId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: stocks } = await supabase
    .from("warehouse_stock")
    .select("id, product_id, quantity, state")
    .eq("warehouse_id", warehouseId);
  type S = { id: string; product_id: string; quantity: number; state: string };
  const list = (stocks ?? []) as S[];
  if (list.length === 0) return [];
  const ids = Array.from(new Set(list.map((s) => s.product_id)));
  const { data: prods } = await supabase.from("products").select("id, name").in("id", ids);
  const nameMap = new Map(((prods ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return list.map((s) => ({ ...s, product_name: nameMap.get(s.product_id) ?? "?" }));
}

export interface WarehouseRow {
  id: string;
  name: string;
  kind: "main" | "secondary" | "vehicle" | "external_supplier";
  vehicle_plate: string | null;
  assigned_user_id: string | null;
  is_active: boolean;
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("id, name, kind, vehicle_plate, assigned_user_id, is_active")
    .is("deleted_at", null)
    .order("kind")
    .order("name");
  if (error) throw error;
  return (data ?? []) as WarehouseRow[];
}

export interface LoadingRequestRow {
  id: string;
  status: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  needed_for: string | null;
  created_at: string;
}

export async function listLoadingRequests(): Promise<LoadingRequestRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loading_requests")
    .select("id, status, source_warehouse_id, destination_warehouse_id, needed_for, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as LoadingRequestRow[];
}
