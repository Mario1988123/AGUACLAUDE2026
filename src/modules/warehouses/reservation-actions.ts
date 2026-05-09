"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Devuelve el ID del almacén "principal" de la empresa. Si no hay ninguno
 * con kind='main', usa el primer almacén no-vehículo. Si solo hay
 * furgonetas, devuelve la primera furgoneta como fallback.
 */
async function findMainWarehouseId(companyId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: mains } = await admin
    .from("warehouses")
    .select("id, kind")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("kind"); // 'main' viene antes alfabéticamente
  const list = (mains ?? []) as Array<{ id: string; kind: string }>;
  if (list.length === 0) return null;
  const main = list.find((w) => w.kind === "main");
  if (main) return main.id;
  const fixed = list.find((w) => w.kind !== "vehicle");
  if (fixed) return fixed.id;
  return list[0]?.id ?? null;
}

export interface StockReservation {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  contract_id: string;
  contract_reference: string | null;
  customer_name: string | null;
  quantity: number;
  status: "active" | "fulfilled" | "cancelled";
  reserved_at: string;
  fulfilled_at: string | null;
  cancelled_at: string | null;
}

/**
 * Crea reservas de stock para todos los items de un contrato. Idempotente:
 * si ya existen reservas activas para ese contrato, no duplica.
 *
 * Si el contrato no se ha enlazado todavía a `contracts.items` o equivalente,
 * fail-soft: registra log y retorna { ok: false } sin lanzar para no romper
 * la firma del contrato.
 */
export async function reserveStockForContractAction(
  contractId: string,
): Promise<{ ok: boolean; reserved: number; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, reserved: 0, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Si ya hay reservas activas para este contrato, no duplicamos.
    const { data: existing } = await admin
      .from("stock_reservations")
      .select("id")
      .eq("contract_id", contractId)
      .eq("status", "active")
      .limit(1);
    if (((existing ?? []) as Array<unknown>).length > 0) {
      return { ok: true, reserved: 0 };
    }

    // Resolver almacén principal
    const mainWarehouseId = await findMainWarehouseId(session.company_id);
    if (!mainWarehouseId) {
      return { ok: false, reserved: 0, error: "No hay almacén configurado" };
    }

    // Items del contrato — la tabla puede llamarse contract_items o contract_lines.
    // Probamos contract_items primero (esquema actual); fallback a leer del snapshot.
    let items: Array<{ product_id: string; quantity: number }> = [];
    try {
      const { data: ci } = await admin
        .from("contract_items")
        .select("product_id, quantity")
        .eq("contract_id", contractId);
      items = ((ci ?? []) as Array<{ product_id: string | null; quantity: number | null }>)
        .filter((i) => i.product_id && (i.quantity ?? 0) > 0)
        .map((i) => ({ product_id: i.product_id!, quantity: i.quantity! }));
    } catch {
      /* tabla no existe */
    }
    if (items.length === 0) {
      // Sin items que reservar — no es error.
      return { ok: true, reserved: 0 };
    }

    const rows = items.map((it) => ({
      company_id: session.company_id,
      warehouse_id: mainWarehouseId,
      product_id: it.product_id,
      contract_id: contractId,
      quantity: it.quantity,
      status: "active" as const,
      reserved_by: session.user_id,
    }));
    const { error } = await admin.from("stock_reservations").insert(rows);
    if (error) {
      console.error("[reserveStockForContract]", error.message);
      return { ok: false, reserved: 0, error: error.message };
    }
    revalidatePath(`/almacenes/${mainWarehouseId}`);
    revalidatePath("/almacenes");
    return { ok: true, reserved: rows.length };
  } catch (e) {
    console.error("[reserveStockForContract] exception", e);
    return {
      ok: false,
      reserved: 0,
      error: e instanceof Error ? e.message : "Error",
    };
  }
}

/**
 * Cancela todas las reservas activas de un contrato (cuando se cancela
 * el contrato, etc).
 */
export async function cancelReservationsForContractAction(
  contractId: string,
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("stock_reservations")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .eq("status", "active");
}

/**
 * Marca como cumplidas las reservas de un contrato (típicamente al
 * completar la instalación).
 */
export async function fulfillReservationsForContractAction(
  contractId: string,
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("stock_reservations")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .eq("status", "active");
}

/**
 * Lista reservas (por defecto solo activas) con info del contrato y producto.
 */
export async function listReservations(filter?: {
  warehouse_id?: string;
  status?: "active" | "fulfilled" | "cancelled";
}): Promise<StockReservation[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("stock_reservations")
    .select(
      "id, warehouse_id, product_id, contract_id, quantity, status, reserved_at, fulfilled_at, cancelled_at",
    )
    .order("reserved_at", { ascending: false });
  if (filter?.warehouse_id) q = q.eq("warehouse_id", filter.warehouse_id);
  q = q.eq("status", filter?.status ?? "active");
  const { data: rows } = await q;
  type R = {
    id: string;
    warehouse_id: string;
    product_id: string;
    contract_id: string;
    quantity: number;
    status: "active" | "fulfilled" | "cancelled";
    reserved_at: string;
    fulfilled_at: string | null;
    cancelled_at: string | null;
  };
  const list = (rows ?? []) as R[];
  if (list.length === 0) return [];

  const productIds = Array.from(new Set(list.map((r) => r.product_id)));
  const warehouseIds = Array.from(new Set(list.map((r) => r.warehouse_id)));
  const contractIds = Array.from(new Set(list.map((r) => r.contract_id)));

  const [pRes, wRes, cRes] = await Promise.all([
    supabase.from("products").select("id, name").in("id", productIds),
    supabase.from("warehouses").select("id, name").in("id", warehouseIds),
    supabase
      .from("contracts")
      .select("id, reference_code, customer_snapshot")
      .in("id", contractIds),
  ]);
  const pMap = new Map(
    ((pRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const wMap = new Map(
    ((wRes.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]),
  );
  type CT = {
    id: string;
    reference_code: string | null;
    customer_snapshot: Record<string, unknown> | null;
  };
  const cMap = new Map(((cRes.data ?? []) as CT[]).map((c) => [c.id, c]));

  function customerNameFromSnapshot(snap: Record<string, unknown> | null | undefined): string | null {
    if (!snap) return null;
    const s = snap as {
      legal_name?: string | null;
      trade_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    };
    return (
      s.trade_name ||
      s.legal_name ||
      `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
      null
    );
  }

  return list.map((r) => {
    const c = cMap.get(r.contract_id);
    return {
      ...r,
      warehouse_name: wMap.get(r.warehouse_id) ?? "?",
      product_name: pMap.get(r.product_id) ?? "?",
      contract_reference: c?.reference_code ?? null,
      customer_name: customerNameFromSnapshot(c?.customer_snapshot),
    };
  });
}

/**
 * Cantidad reservada activa por (warehouse, product). Para mostrar
 * "disponible vs reservado" en /almacenes/[id].
 */
export async function getReservedByWarehouse(
  warehouseId: string,
): Promise<Map<string, number>> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let rows: Array<{ product_id: string; quantity: number }> = [];
  try {
    const { data } = await supabase
      .from("stock_reservations")
      .select("product_id, quantity")
      .eq("warehouse_id", warehouseId)
      .eq("status", "active");
    rows = (data ?? []) as typeof rows;
  } catch {
    return new Map();
  }
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.product_id, (m.get(r.product_id) ?? 0) + r.quantity);
  return m;
}
