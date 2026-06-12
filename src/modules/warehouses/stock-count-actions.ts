"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface StockCountRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  label: string;
  status: "open" | "completed" | "cancelled";
  started_at: string;
  completed_at: string | null;
}

async function ensureAuthorized() {
  const session = await requireSession();
  const ok =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("installer");
  if (!ok) throw new Error("No autorizado");
  return session;
}

/** Inicia un conteo cíclico cargando expected_qty desde warehouse_stock
 *  para cada producto gestionado del almacén. */
export async function startStockCountAction(input: {
  warehouse_id: string;
  label: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureAuthorized();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!input.label?.trim())
      return { ok: false, error: "Etiqueta obligatoria" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // anti cross-tenant: el almacén (warehouse_id viene del navegador) debe ser de mi empresa
    const { data: ownWh } = await admin
      .from("warehouses")
      .select("id")
      .eq("id", input.warehouse_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!ownWh) return { ok: false, error: "Almacén no encontrado" };

    // Crear cabecera
    const ins = await admin
      .from("stock_counts")
      .insert({
        company_id: session.company_id,
        warehouse_id: input.warehouse_id,
        label: input.label.trim(),
        started_by: session.user_id,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    const id = (ins.data as { id: string }).id;

    // Snapshot expected: cada producto que tenga stock en este almacén
    const { data: stocks } = await admin
      .from("warehouse_stock")
      .select("product_id, quantity")
      .eq("warehouse_id", input.warehouse_id)
      .eq("company_id", session.company_id);
    type S = { product_id: string; quantity: number };
    const items = ((stocks ?? []) as S[]).map((s) => ({
      count_id: id,
      product_id: s.product_id,
      expected_qty: s.quantity,
    }));
    if (items.length > 0) {
      await admin.from("stock_count_items").insert(items);
    }
    revalidatePath("/almacenes/conteo");
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function listStockCounts(): Promise<StockCountRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("stock_counts")
    .select("id, warehouse_id, label, status, started_at, completed_at")
    .eq("company_id", session.company_id)
    .order("started_at", { ascending: false })
    .limit(50);
  type R = Omit<StockCountRow, "warehouse_name">;
  const rows = (data ?? []) as R[];
  if (rows.length === 0) return [];
  const wIds = Array.from(new Set(rows.map((r) => r.warehouse_id)));
  const { data: ws } = await admin
    .from("warehouses")
    .select("id, name")
    .in("id", wIds);
  const nameMap = new Map<string, string>();
  for (const w of (ws ?? []) as Array<{ id: string; name: string }>) {
    nameMap.set(w.id, w.name);
  }
  return rows.map((r) => ({
    ...r,
    warehouse_name: nameMap.get(r.warehouse_id) ?? null,
  }));
}

/** Cierra el conteo aplicando ajustes para los productos con diff. */
export async function completeStockCountAction(
  countId: string,
): Promise<{ ok: true; adjustments: number } | { ok: false; error: string }> {
  try {
    const session = await ensureAuthorized();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: items } = await admin
      .from("stock_count_items")
      .select("product_id, expected_qty, counted_qty, diff")
      .eq("count_id", countId);
    type I = {
      product_id: string;
      expected_qty: number;
      counted_qty: number | null;
      diff: number | null;
    };
    const rows = ((items ?? []) as I[]).filter((i) => i.counted_qty != null);
    // Almacén del conteo. SEGURIDAD: admin salta RLS → filtrar por company_id y
    // abortar si el conteo no es de tu empresa (si no, se reconciliaría stock ajeno).
    const { data: count } = await admin
      .from("stock_counts")
      .select("warehouse_id")
      .eq("id", countId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!count) return { ok: false, error: "Conteo no encontrado o no pertenece a tu empresa" };
    const whId = (count as { warehouse_id?: string } | null)?.warehouse_id;
    let adjustments = 0;
    if (whId) {
      for (const i of rows) {
        const counted = Number(i.counted_qty);
        const diff = counted - Number(i.expected_qty);
        if (diff === 0) continue;

        // 1) RECONCILIAR el stock real al valor contado (antes solo se
        //    registraba el movimiento pero warehouse_stock no se tocaba →
        //    el descuadre seguía ahí).
        const { data: existing } = await admin
          .from("warehouse_stock")
          .select("id")
          .eq("warehouse_id", whId)
          .eq("product_id", i.product_id)
          .eq("company_id", session.company_id)
          .eq("state", "new")
          .is("location_id", null)
          .maybeSingle();
        const exRow = existing as { id: string } | null;
        if (exRow) {
          await admin
            .from("warehouse_stock")
            .update({ quantity: counted })
            .eq("id", exRow.id)
            .eq("company_id", session.company_id);
        } else if (counted > 0) {
          await admin.from("warehouse_stock").insert({
            company_id: session.company_id,
            warehouse_id: whId,
            product_id: i.product_id,
            quantity: counted,
            state: "new",
          });
        }

        // 2) Registrar el movimiento con el tipo VÁLIDO del enum
        //    (adjustment_plus/adjustment_minus; 'adjustment' no existe) y
        //    cantidad positiva.
        const { error: movErr } = await admin.from("stock_movements").insert({
          company_id: session.company_id,
          product_id: i.product_id,
          warehouse_id: whId,
          movement_type: diff > 0 ? "adjustment_plus" : "adjustment_minus",
          quantity: Math.abs(diff),
          state_after: "new",
          notes: `Ajuste por conteo ${countId.slice(0, 8)}`,
          performed_by: session.user_id,
          performed_at: new Date().toISOString(),
        });
        if (movErr) {
          console.error("[applyStockCount] movimiento falló:", movErr.message);
        }
        adjustments++;
      }
    }
    await admin
      .from("stock_counts")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: session.user_id,
      })
      .eq("id", countId)
      .eq("company_id", session.company_id);
    revalidatePath("/almacenes/conteo");
    revalidatePath("/almacenes");
    return { ok: true, adjustments };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function recordCountedQtyAction(
  itemId: string,
  countedQty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAuthorized();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // SEGURIDAD: stock_count_items NO tiene company_id → verificamos el padre
    // (stock_counts) por company_id antes de actualizar.
    const { data: prev } = await admin
      .from("stock_count_items")
      .select("expected_qty, count_id")
      .eq("id", itemId)
      .maybeSingle();
    if (!prev) return { ok: false, error: "Línea de conteo no encontrada" };
    const parentId = (prev as { count_id?: string } | null)?.count_id;
    const { data: parent } = await admin
      .from("stock_counts")
      .select("id")
      .eq("id", parentId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!parent) return { ok: false, error: "El conteo no pertenece a tu empresa" };
    const exp = Number(
      (prev as { expected_qty?: number } | null)?.expected_qty ?? 0,
    );
    const r = await admin
      .from("stock_count_items")
      .update({
        counted_qty: countedQty,
        diff: countedQty - exp,
        counted_by: session.user_id,
        counted_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
