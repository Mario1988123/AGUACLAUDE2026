"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

const warehouseUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2),
  kind: z.enum(["main", "secondary", "vehicle", "external_supplier"]),
  vehicle_plate: z.string().optional().default(""),
  assigned_user_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().default(""),
  // Dirección física (no aplica a vehicle ni external_supplier necesariamente)
  address_street: z.string().optional().default(""),
  address_postal_code: z.string().optional().default(""),
  address_city: z.string().optional().default(""),
  address_province: z.string().optional().default(""),
  latitude: z.coerce.number().nullish(),
  longitude: z.coerce.number().nullish(),
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
  if (!session.company_id) throw new Error("Sin empresa");
  const parsed = parseOrFriendly(warehouseUpsertSchema, input, "Almacén");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Geocoding automático: si hay calle+ciudad pero no coords, geocodear.
  // Si el usuario las puso a mano, las respetamos.
  let lat = parsed.latitude ?? null;
  let lng = parsed.longitude ?? null;
  let geoSource: string | null = null;
  if (lat == null && lng == null && parsed.address_street && parsed.address_city) {
    try {
      const { forwardGeocodeAction } = await import("@/shared/lib/geocoding/actions");
      const queryParts = [
        parsed.address_street,
        parsed.address_postal_code,
        parsed.address_city,
        parsed.address_province,
        "España",
      ].filter(Boolean);
      const r = await forwardGeocodeAction(queryParts.join(", "));
      if (r) {
        lat = r.lat;
        lng = r.lng;
        geoSource = "geocoded";
      }
    } catch (e) {
      console.error("[upsertWarehouse] geocode falló:", e);
    }
  } else if (lat != null && lng != null) {
    geoSource = "user_pin";
  }

  const payload = {
    company_id: session.company_id,
    name: parsed.name,
    kind: parsed.kind,
    vehicle_plate: parsed.vehicle_plate || null,
    assigned_user_id: parsed.assigned_user_id || null,
    notes: parsed.notes || null,
    address_street: parsed.address_street || null,
    address_postal_code: parsed.address_postal_code || null,
    address_city: parsed.address_city || null,
    address_province: parsed.address_province || null,
    latitude: lat,
    longitude: lng,
    geo_source: geoSource,
    is_active: true,
  };
  if (parsed.id) {
    // SEGURIDAD: admin salta RLS → filtrar por company_id.
    const { data, error } = await admin
      .from("warehouses")
      .update(payload)
      .eq("id", parsed.id)
      .eq("company_id", session.company_id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Almacén no encontrado o no pertenece a tu empresa");
  } else {
    const { error } = await admin.from("warehouses").insert(payload);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/almacenes");
}

export async function deleteWarehouseAction(id: string) {
  const session = await ensureCanManageWarehouses();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin salta RLS → filtrar por company_id.
  const { data, error } = await admin
    .from("warehouses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", session.company_id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Almacén no encontrado o no pertenece a tu empresa");
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
  address_street: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  address_province: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select(
      "id, name, kind, vehicle_plate, assigned_user_id, is_active, address_street, address_postal_code, address_city, address_province, latitude, longitude",
    )
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

// =================== Safe wrappers ===================

export async function upsertWarehouseSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertWarehouseAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteWarehouseSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteWarehouseAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
