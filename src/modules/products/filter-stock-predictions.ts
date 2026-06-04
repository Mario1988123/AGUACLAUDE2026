"use server";
/**
 * Predicciones de stock de filtros y recambios. Tras la auditoría
 * 2026-06-04 se reescribió para usar la nueva tabla `filter_stock`
 * (migración 20260604120000) en lugar de la incorrecta
 * `warehouse_stock.filter_id` (esa columna NO existe — warehouse_stock
 * solo gestiona products).
 *
 * Flujo:
 *   1) Lista todos los filtros activos de la empresa.
 *   2) Por cada uno, calcula la demanda esperada en los próximos 90 días:
 *      número de equipos instalados (customer_equipment) × cuántas veces
 *      se cambia el filtro en esa ventana, según replacement_period_months
 *      de la asignación filter↔equipo.
 *   3) Suma el stock actual del filtro (filter_stock) y el stock de los
 *      filtros equivalentes (product_filter_compatibilities).
 *   4) Devuelve la lista con severidad:
 *      - critical: demanda > stock total Y stock < stock_min.
 *      - warning:  demanda > stock total.
 *      - info:     demanda > 0 pero el stock cubre.
 *
 * Defensivo: si alguna tabla no existe (migración futura no aplicada),
 * la función NO rompe; devuelve los datos que sí pudo leer.
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface FilterStockPrediction {
  filter_id: string;
  filter_name: string;
  filter_internal_reference: string | null;
  expected_demand_next_90d: number;
  current_stock: number;
  compatible_stock: number;
  /** Demanda - (stock propio + stock compatibles). >0 = faltan unidades. */
  shortage: number;
  severity: "critical" | "warning" | "info";
}

const HORIZON_DAYS = 90;

export async function getFilterStockPredictions(): Promise<FilterStockPrediction[]> {
  const session = await requireSession();
  if (!session.company_id) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Filtros activos
  const { data: filters } = await admin
    .from("product_filters")
    .select("id, name, internal_reference, lifespan_months, stock_min")
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .is("deleted_at", null);
  type Filter = {
    id: string;
    name: string;
    internal_reference: string | null;
    lifespan_months: number | null;
    stock_min: number;
  };
  const filterList = (filters ?? []) as Filter[];
  if (filterList.length === 0) return [];

  // 2) Asignaciones filter ↔ equipo
  const { data: assignments } = await admin
    .from("product_filter_assignments")
    .select(
      "product_id, filter_id, replacement_period_months, quantity_per_change",
    )
    .eq("company_id", session.company_id);
  type Assign = {
    product_id: string;
    filter_id: string;
    replacement_period_months: number | null;
    quantity_per_change: number;
  };
  const assignList = (assignments ?? []) as Assign[];

  // 3) Equipos instalados por producto
  const installedByProduct = new Map<string, number>();
  try {
    const { data: equipments } = await admin
      .from("customer_equipment")
      .select("product_id")
      .eq("company_id", session.company_id)
      .eq("is_active", true);
    type Equip = { product_id: string | null };
    for (const e of ((equipments ?? []) as Equip[])) {
      if (e.product_id) {
        installedByProduct.set(
          e.product_id,
          (installedByProduct.get(e.product_id) ?? 0) + 1,
        );
      }
    }
  } catch (err) {
    console.warn("[filter-stock-predictions] no se pudo leer customer_equipment:", err);
  }

  // 4) Demanda esperada en 90 días por filtro
  const demand = new Map<string, number>();
  for (const a of assignList) {
    const period = a.replacement_period_months;
    if (!period || period <= 0) continue;
    const installed = installedByProduct.get(a.product_id) ?? 0;
    if (installed === 0) continue;
    // En HORIZON_DAYS / (period × 30 días) ciclos de cambio por equipo.
    const changesPerEquip = HORIZON_DAYS / (period * 30);
    const totalUnits = installed * changesPerEquip * (a.quantity_per_change ?? 1);
    demand.set(a.filter_id, (demand.get(a.filter_id) ?? 0) + totalUnits);
  }

  // 5) Stock actual por filtro (tabla nueva filter_stock; defensiva)
  const stockByFilter = new Map<string, number>();
  try {
    const { data: rows, error } = await admin
      .from("filter_stock")
      .select("filter_id, quantity")
      .eq("company_id", session.company_id);
    if (error) {
      // Tabla aún no aplicada → stock 0 para todos
      if (
        /relation .* does not exist|schema cache/i.test(error.message ?? "") ||
        (error as { code?: string }).code === "42P01"
      ) {
        console.warn(
          "[filter-stock-predictions] filter_stock no existe todavía; aplicar migración 20260604120000",
        );
      } else {
        console.warn("[filter-stock-predictions] error leyendo filter_stock:", error.message);
      }
    } else {
      type Row = { filter_id: string; quantity: number };
      for (const r of (rows ?? []) as Row[]) {
        stockByFilter.set(r.filter_id, (stockByFilter.get(r.filter_id) ?? 0) + r.quantity);
      }
    }
  } catch (err) {
    console.warn("[filter-stock-predictions] excepción leyendo filter_stock:", err);
  }

  // 6) Compatibilidades (si falta A, vale B)
  const compatMap = new Map<string, string[]>();
  try {
    const { data: comps } = await admin
      .from("product_filter_compatibilities")
      .select("filter_a_id, filter_b_id")
      .eq("company_id", session.company_id);
    type Comp = { filter_a_id: string; filter_b_id: string };
    for (const c of ((comps ?? []) as Comp[])) {
      if (!compatMap.has(c.filter_a_id)) compatMap.set(c.filter_a_id, []);
      compatMap.get(c.filter_a_id)!.push(c.filter_b_id);
    }
  } catch (err) {
    console.warn("[filter-stock-predictions] no se pudo leer compatibilidades:", err);
  }

  // 7) Resultado
  const result: FilterStockPrediction[] = [];
  for (const f of filterList) {
    const expectedDemand = Math.ceil(demand.get(f.id) ?? 0);
    const currentStock = stockByFilter.get(f.id) ?? 0;
    const compatStock = (compatMap.get(f.id) ?? []).reduce(
      (sum, otherId) => sum + (stockByFilter.get(otherId) ?? 0),
      0,
    );

    // Ignorar filtros sin demanda y con stock suficiente
    if (expectedDemand === 0 && currentStock >= f.stock_min) continue;

    const shortage = Math.max(0, expectedDemand - currentStock - compatStock);
    let severity: FilterStockPrediction["severity"] = "info";
    if (shortage > 0) severity = "warning";
    if (
      (shortage > 0 && currentStock < f.stock_min) ||
      (currentStock < f.stock_min && expectedDemand > 0)
    ) {
      severity = "critical";
    }

    result.push({
      filter_id: f.id,
      filter_name: f.name,
      filter_internal_reference: f.internal_reference,
      expected_demand_next_90d: expectedDemand,
      current_stock: currentStock,
      compatible_stock: compatStock,
      shortage,
      severity,
    });
  }

  const sevOrder = { critical: 0, warning: 1, info: 2 } as const;
  return result.sort(
    (a, b) =>
      sevOrder[a.severity] - sevOrder[b.severity] || b.shortage - a.shortage,
  );
}
