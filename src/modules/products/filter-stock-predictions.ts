"use server";
/**
 * Stock predictivo de filtros: cuenta cuántas unidades de cada filtro se
 * van a necesitar en los próximos N días, leyendo:
 *   - product_filter_assignments (qué filtro lleva cada equipo y cada cuánto)
 *   - customer_equipment (equipos instalados en clientes)
 *   - maintenance_jobs (mantenimientos programados próximos)
 *
 * Si la disponibilidad de stock es menor que la demanda esperada, devuelve
 * el filtro como "alerta". Si declara compatibilidades (product_filter_compatibilities),
 * suma el stock de los filtros equivalentes.
 *
 * Defensivo: cualquier tabla que no esté aplicada todavía se ignora.
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
  const filterList = (filters ?? []) as Array<{
    id: string;
    name: string;
    internal_reference: string | null;
    lifespan_months: number | null;
    stock_min: number;
  }>;
  if (filterList.length === 0) return [];

  // 2) Asignaciones de filtros a equipos
  const { data: assignments } = await admin
    .from("product_filter_assignments")
    .select(
      "product_id, filter_id, replacement_period_months, quantity_per_change, is_required",
    )
    .eq("company_id", session.company_id);
  type Assign = {
    product_id: string;
    filter_id: string;
    replacement_period_months: number | null;
    quantity_per_change: number;
    is_required: boolean;
  };
  const assignList = (assignments ?? []) as Assign[];

  // 3) Equipos instalados en clientes (customer_equipment)
  let installedByProduct = new Map<string, number>();
  try {
    const { data: equipments } = await admin
      .from("customer_equipment")
      .select("product_id")
      .eq("company_id", session.company_id);
    type Equip = { product_id: string | null };
    for (const e of ((equipments ?? []) as Equip[])) {
      if (e.product_id) {
        installedByProduct.set(
          e.product_id,
          (installedByProduct.get(e.product_id) ?? 0) + 1,
        );
      }
    }
  } catch {
    /* tabla puede no existir */
    installedByProduct = new Map();
  }

  // 4) Calcular demanda esperada de cada filtro en los próximos 90 días.
  // Modelo simple: para cada (equipo, filtro) → si el periodo de cambio es
  // 12 meses, en 90 días/365*1 = 0,247 cambios por equipo × unidades instaladas.
  const demand = new Map<string, number>();
  for (const a of assignList) {
    const period = a.replacement_period_months;
    if (!period || period <= 0) continue;
    const installed = installedByProduct.get(a.product_id) ?? 0;
    if (installed === 0) continue;
    const changesPerEquip = HORIZON_DAYS / (period * 30);
    const totalUnits = installed * changesPerEquip * (a.quantity_per_change ?? 1);
    demand.set(a.filter_id, (demand.get(a.filter_id) ?? 0) + totalUnits);
  }

  // 5) Stock actual por filtro (warehouse_stock o tabla derivada)
  // Defensivo: intentamos warehouse_stock con filter_id; si no existe esa
  // columna, asumimos 0 (Fase 5 menor: usar movimientos).
  let stockByFilter = new Map<string, number>();
  try {
    const { data: ws, error } = await admin
      .from("warehouse_stock")
      .select("filter_id, qty")
      .eq("company_id", session.company_id);
    if (!error) {
      type WS = { filter_id: string | null; qty: number };
      for (const r of ((ws ?? []) as WS[])) {
        if (r.filter_id) {
          stockByFilter.set(r.filter_id, (stockByFilter.get(r.filter_id) ?? 0) + r.qty);
        }
      }
    }
  } catch {
    /* tabla no aplicable, stock = 0 */
    stockByFilter = new Map();
  }

  // 6) Compatibilidades
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
  } catch {
    /* tabla no aplicable */
  }

  // 7) Componer respuesta
  const result: FilterStockPrediction[] = [];
  for (const f of filterList) {
    const expectedDemand = Math.ceil(demand.get(f.id) ?? 0);
    if (expectedDemand === 0 && (stockByFilter.get(f.id) ?? 0) >= f.stock_min) continue;
    const currentStock = stockByFilter.get(f.id) ?? 0;
    const compatStock = (compatMap.get(f.id) ?? []).reduce(
      (sum, otherId) => sum + (stockByFilter.get(otherId) ?? 0),
      0,
    );
    const shortage = Math.max(0, expectedDemand - currentStock - compatStock);
    let severity: FilterStockPrediction["severity"] = "info";
    if (shortage > 0) severity = "warning";
    if (shortage > currentStock + compatStock || currentStock < f.stock_min)
      severity = "critical";

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

  // Ordenar: críticos primero, luego warning, luego info
  const sevOrder = { critical: 0, warning: 1, info: 2 } as const;
  return result.sort(
    (a, b) =>
      sevOrder[a.severity] - sevOrder[b.severity] || b.shortage - a.shortage,
  );
}
