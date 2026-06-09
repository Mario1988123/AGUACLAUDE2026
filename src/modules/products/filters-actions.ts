"use server";
/**
 * Server actions del módulo de FILTROS y recambios (Fase 5).
 *
 * Modelo: product_filters + product_filter_assignments +
 * product_filter_compatibilities (migración 20260604100900).
 *
 * Reglas:
 *   - Solo admin (nivel 1) escribe.
 *   - Nivel 1, 2 y 3 leen.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";
import type { FilterType } from "./filters-constants";

export interface ProductFilterItem {
  id: string;
  name: string;
  internal_reference: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  filter_type: FilterType;
  micron_rating: number | null;
  size_inches: string | null;
  connection_inches: string | null;
  capacity_liters: number | null;
  lifespan_months: number | null;
  cost_cents: number | null;
  sale_price_cents: number | null;
  stock_managed: boolean;
  stock_min: number;
  stock_max: number | null;
  supplier_lead_time_days: number | null;
  main_image_url: string | null;
  is_active: boolean;
  notes: string | null;
  /** Vendible suelto / mostrar en catálogo (Fase C). false si la migración no se aplicó. */
  show_in_catalog?: boolean;
  /** Equipos a los que está asignado este filtro. */
  assignment_count?: number;
}

export type FilterActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// =============================================================================
// LISTAR
// =============================================================================

export async function listProductFilters(filters?: {
  filter_type?: FilterType;
  q?: string;
  active_only?: boolean;
}): Promise<ProductFilterItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const BASE_COLS =
    "id, name, internal_reference, manufacturer_name, manufacturer_model, filter_type, micron_rating, size_inches, connection_inches, capacity_liters, lifespan_months, cost_cents, sale_price_cents, stock_managed, stock_min, stock_max, supplier_lead_time_days, main_image_url, is_active, notes";
  function build(cols: string) {
    let q = supabase.from("product_filters").select(cols).is("deleted_at", null).order("name");
    if (filters?.filter_type) q = q.eq("filter_type", filters.filter_type);
    if (filters?.active_only) q = q.eq("is_active", true);
    if (filters?.q) {
      const txt = filters.q.replace(/[%_]/g, "");
      q = q.or(`name.ilike.%${txt}%,internal_reference.ilike.%${txt}%`);
    }
    return q;
  }
  // Defensivo: show_in_catalog es columna nueva (migración 20260609120000).
  let { data, error } = await build(BASE_COLS + ", show_in_catalog");
  if (error && /show_in_catalog/i.test(error.message ?? "")) {
    const fb = await build(BASE_COLS);
    data = fb.data;
    error = fb.error;
  }
  const rows = (data ?? []) as ProductFilterItem[];

  if (rows.length === 0) return [];

  // Conteo de asignaciones por filtro
  const ids = rows.map((r) => r.id);
  const { data: assignments } = await supabase
    .from("product_filter_assignments")
    .select("filter_id")
    .in("filter_id", ids);
  const counts = new Map<string, number>();
  for (const a of ((assignments ?? []) as Array<{ filter_id: string }>)) {
    counts.set(a.filter_id, (counts.get(a.filter_id) ?? 0) + 1);
  }
  return rows.map((r) => ({
    ...r,
    assignment_count: counts.get(r.id) ?? 0,
  }));
}

export async function getProductFilter(filterId: string): Promise<ProductFilterItem | null> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const BASE_COLS =
    "id, name, internal_reference, manufacturer_name, manufacturer_model, filter_type, micron_rating, size_inches, connection_inches, capacity_liters, lifespan_months, cost_cents, sale_price_cents, stock_managed, stock_min, stock_max, supplier_lead_time_days, main_image_url, is_active, notes";
  const res = await supabase
    .from("product_filters")
    .select(BASE_COLS + ", show_in_catalog")
    .eq("id", filterId)
    .is("deleted_at", null)
    .maybeSingle();
  let data = res.data;
  if (res.error && /show_in_catalog/i.test(res.error.message ?? "")) {
    const fb = await supabase
      .from("product_filters")
      .select(BASE_COLS)
      .eq("id", filterId)
      .is("deleted_at", null)
      .maybeSingle();
    data = fb.data;
  }
  return (data ?? null) as ProductFilterItem | null;
}

// =============================================================================
// CREAR / ACTUALIZAR
// =============================================================================

export interface UpsertFilterInput {
  id?: string;
  name: string;
  internal_reference?: string | null;
  manufacturer_name?: string | null;
  manufacturer_model?: string | null;
  filter_type?: FilterType;
  micron_rating?: number | null;
  size_inches?: string | null;
  connection_inches?: string | null;
  capacity_liters?: number | null;
  lifespan_months?: number | null;
  sale_price_cents?: number | null;
  stock_managed?: boolean;
  stock_min?: number;
  stock_max?: number | null;
  supplier_lead_time_days?: number | null;
  main_image_url?: string | null;
  is_active?: boolean;
  notes?: string | null;
  show_in_catalog?: boolean;
}

export async function upsertProductFilterAction(
  input: UpsertFilterInput,
): Promise<FilterActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio." };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // cost_cents NO se actualiza a mano (igual que productos: CMP desde compras).
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      name: input.name.trim(),
      internal_reference: input.internal_reference?.trim() || null,
      manufacturer_name: input.manufacturer_name?.trim() || null,
      manufacturer_model: input.manufacturer_model?.trim() || null,
      filter_type: input.filter_type ?? "other",
      micron_rating: input.micron_rating ?? null,
      size_inches: input.size_inches?.trim() || null,
      connection_inches: input.connection_inches?.trim() || null,
      capacity_liters: input.capacity_liters ?? null,
      lifespan_months: input.lifespan_months ?? null,
      sale_price_cents: input.sale_price_cents ?? null,
      stock_managed: input.stock_managed ?? true,
      stock_min: input.stock_min ?? 0,
      stock_max: input.stock_max ?? null,
      supplier_lead_time_days: input.supplier_lead_time_days ?? null,
      main_image_url: input.main_image_url?.trim() || null,
      is_active: input.is_active ?? true,
      notes: input.notes?.trim() || null,
      // Columna nueva (migración 20260609120000). Defensivo más abajo.
      show_in_catalog: input.show_in_catalog ?? false,
    };
    const isNewColError = (msg: string | undefined) => /show_in_catalog/i.test(msg ?? "");

    if (input.id) {
      let { error } = await admin
        .from("product_filters")
        .update(payload)
        .eq("id", input.id)
        .eq("company_id", session.company_id);
      if (error && isNewColError(error.message)) {
        const { show_in_catalog: _omit, ...rest } = payload;
        const r2 = await admin
          .from("product_filters")
          .update(rest)
          .eq("id", input.id)
          .eq("company_id", session.company_id);
        error = r2.error;
      }
      if (error) return { ok: false, error: error.message };
      revalidatePath("/productos/filtros");
      revalidatePath(`/productos/filtros/${input.id}`);
      return { ok: true, id: input.id };
    }
    payload.created_by = session.user_id;
    let { data, error } = await admin
      .from("product_filters")
      .insert(payload)
      .select("id")
      .single();
    if (error && isNewColError(error.message)) {
      const { show_in_catalog: _omit, ...rest } = payload;
      const r2 = await admin.from("product_filters").insert(rest).select("id").single();
      data = r2.data;
      error = r2.error;
    }
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { ok: false, error: "Ya hay un filtro con esa referencia interna." };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/productos/filtros");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Soft-delete (deleted_at). El registro persiste para que las asignaciones e
 * histórico de stock sigan funcionando.
 */
export async function deleteProductFilterAction(
  filterId: string,
): Promise<FilterActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_filters")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", filterId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/productos/filtros");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
