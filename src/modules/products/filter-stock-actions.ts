"use server";
/**
 * Server actions para gestionar el stock real de filtros y recambios.
 * Modelo: filter_stock + filter_stock_movements (migración 20260604120000).
 *
 * Reglas:
 *   - Lectura: cualquier rol autenticado de la empresa.
 *   - Escritura: solo company_admin (regla feedback_productos_permisos).
 *
 * El stock se gestiona POR ALMACÉN. Si no se especifica almacén, se usa el
 * almacén principal de la empresa (`warehouses.is_main = true`).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export interface FilterStockRow {
  filter_id: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
}

/**
 * Devuelve el stock total por filtro (sumado de todos los almacenes) y
 * detalle por almacén. Útil para el listado /productos/filtros y la
 * edición inline de stock.
 */
export async function listFilterStock(): Promise<{
  total_by_filter: Record<string, number>;
  by_filter_and_warehouse: FilterStockRow[];
  warehouses: Array<{ id: string; name: string; is_main: boolean }>;
}> {
  const session = await requireSession();
  if (!session.company_id) {
    return { total_by_filter: {}, by_filter_and_warehouse: [], warehouses: [] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Almacenes
  const { data: warehousesData } = await supabase
    .from("warehouses")
    .select("id, name, is_main")
    .eq("company_id", session.company_id)
    .order("is_main", { ascending: false })
    .order("name");
  const warehouses =
    ((warehousesData ?? []) as Array<{ id: string; name: string; is_main: boolean }>) ?? [];

  // Stock (defensivo: si la tabla aún no se ha aplicado, devuelve vacío)
  const { data: stockRows, error } = await supabase
    .from("filter_stock")
    .select("filter_id, warehouse_id, quantity")
    .eq("company_id", session.company_id);

  if (error) {
    if (
      /relation .* does not exist|schema cache/i.test(error.message ?? "") ||
      (error as { code?: string }).code === "42P01"
    ) {
      return { total_by_filter: {}, by_filter_and_warehouse: [], warehouses };
    }
    throw error;
  }

  const wname = new Map(warehouses.map((w) => [w.id, w.name]));
  const total: Record<string, number> = {};
  const byPair: FilterStockRow[] = [];
  for (const r of ((stockRows ?? []) as Array<{
    filter_id: string;
    warehouse_id: string;
    quantity: number;
  }>)) {
    total[r.filter_id] = (total[r.filter_id] ?? 0) + r.quantity;
    byPair.push({
      filter_id: r.filter_id,
      warehouse_id: r.warehouse_id,
      warehouse_name: wname.get(r.warehouse_id) ?? "—",
      quantity: r.quantity,
    });
  }

  return { total_by_filter: total, by_filter_and_warehouse: byPair, warehouses };
}

/**
 * Establece el stock manual de un filtro en un almacén. Registra el ajuste
 * en filter_stock_movements como adjustment_in/out según la diferencia.
 *
 * Si no se pasa warehouseId, usa el almacén principal de la empresa.
 */
export async function setFilterStockAction(input: {
  filterId: string;
  quantity: number;
  warehouseId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; quantity: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    if (input.quantity < 0) {
      return { ok: false, error: "La cantidad no puede ser negativa." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Resolver warehouse: pasado o principal de la empresa
    let warehouseId = input.warehouseId ?? null;
    if (!warehouseId) {
      const { data: mainW } = await admin
        .from("warehouses")
        .select("id")
        .eq("company_id", session.company_id)
        .eq("is_main", true)
        .maybeSingle();
      warehouseId = (mainW as { id: string } | null)?.id ?? null;
      if (!warehouseId) {
        const { data: anyW } = await admin
          .from("warehouses")
          .select("id")
          .eq("company_id", session.company_id)
          .limit(1)
          .maybeSingle();
        warehouseId = (anyW as { id: string } | null)?.id ?? null;
      }
    }
    if (!warehouseId) {
      return {
        ok: false,
        error: "No hay almacenes configurados en la empresa.",
      };
    }

    // Verificar que el filtro pertenece a la empresa
    const { data: filterRow } = await admin
      .from("product_filters")
      .select("id, company_id")
      .eq("id", input.filterId)
      .maybeSingle();
    if (
      !filterRow ||
      (filterRow as { company_id: string }).company_id !== session.company_id
    ) {
      return { ok: false, error: "Filtro no encontrado o de otra empresa." };
    }

    // Stock actual (si existe la fila)
    const { data: current } = await admin
      .from("filter_stock")
      .select("id, quantity")
      .eq("filter_id", input.filterId)
      .eq("warehouse_id", warehouseId)
      .is("location_id", null)
      .maybeSingle();

    const previous = (current as { quantity: number } | null)?.quantity ?? 0;
    const diff = input.quantity - previous;

    if (current) {
      const { error: updErr } = await admin
        .from("filter_stock")
        .update({ quantity: input.quantity })
        .eq("id", (current as { id: string }).id);
      if (updErr) return { ok: false, error: updErr.message };
    } else {
      const { error: insErr } = await admin.from("filter_stock").insert({
        company_id: session.company_id,
        warehouse_id: warehouseId,
        filter_id: input.filterId,
        quantity: input.quantity,
      });
      if (insErr) return { ok: false, error: insErr.message };
    }

    // Movimiento de auditoría (si la diferencia es != 0)
    if (diff !== 0) {
      try {
        await admin.from("filter_stock_movements").insert({
          company_id: session.company_id,
          filter_id: input.filterId,
          warehouse_id: warehouseId,
          movement_type: diff > 0 ? "adjustment_in" : "adjustment_out",
          quantity: Math.abs(diff),
          notes: input.notes ?? "Ajuste manual desde /productos/filtros",
          performed_by: session.user_id,
        });
      } catch (err) {
        console.warn("[setFilterStock] no se pudo registrar movimiento:", err);
      }
    }

    revalidatePath("/productos/filtros");
    return { ok: true, quantity: input.quantity };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
