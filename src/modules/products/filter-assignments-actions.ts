"use server";
/**
 * Asignación de filtros a equipos (product_filter_assignments) y
 * compatibilidades entre filtros (product_filter_compatibilities).
 *
 * Reglas:
 *   - Lectura: cualquier rol.
 *   - Escritura: solo admin (regla feedback_productos_permisos).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export interface FilterAssignment {
  id: string;
  filter_id: string;
  filter_name: string;
  filter_type: string;
  stage_position: number | null;
  replacement_period_months: number | null;
  is_required: boolean;
  quantity_per_change: number;
  notes: string | null;
}

export interface FilterCompatibility {
  id: string;
  filter_a_id: string;
  filter_b_id: string;
  filter_a_name: string;
  filter_b_name: string;
  notes: string | null;
}

// =============================================================================
// ASIGNACIONES — listar por equipo
// =============================================================================

export async function listFilterAssignmentsByProduct(
  productId: string,
): Promise<FilterAssignment[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_filter_assignments")
    .select(
      "id, filter_id, stage_position, replacement_period_months, is_required, quantity_per_change, notes, product_filters ( name, filter_type )",
    )
    .eq("product_id", productId)
    .order("stage_position");
  type Row = {
    id: string;
    filter_id: string;
    stage_position: number | null;
    replacement_period_months: number | null;
    is_required: boolean;
    quantity_per_change: number;
    notes: string | null;
    product_filters: { name: string; filter_type: string } | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    filter_id: r.filter_id,
    filter_name: r.product_filters?.name ?? "—",
    filter_type: r.product_filters?.filter_type ?? "other",
    stage_position: r.stage_position,
    replacement_period_months: r.replacement_period_months,
    is_required: r.is_required,
    quantity_per_change: r.quantity_per_change,
    notes: r.notes,
  }));
}

export async function assignFilterToProductAction(input: {
  productId: string;
  filterId: string;
  stagePosition?: number | null;
  replacementPeriodMonths?: number | null;
  isRequired?: boolean;
  quantityPerChange?: number;
  notes?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("product_filter_assignments")
      .insert({
        company_id: session.company_id,
        product_id: input.productId,
        filter_id: input.filterId,
        stage_position: input.stagePosition ?? null,
        replacement_period_months: input.replacementPeriodMonths ?? null,
        is_required: input.isRequired ?? true,
        quantity_per_change: input.quantityPerChange ?? 1,
        notes: input.notes?.trim() || null,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          ok: false,
          error: "Ese filtro ya está asignado al equipo.",
        };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath(`/productos/${input.productId}`);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function updateFilterAssignmentAction(input: {
  assignmentId: string;
  productId: string;
  stagePosition?: number | null;
  replacementPeriodMonths?: number | null;
  isRequired?: boolean;
  quantityPerChange?: number;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const payload: Record<string, unknown> = {};
    if (input.stagePosition !== undefined) payload.stage_position = input.stagePosition;
    if (input.replacementPeriodMonths !== undefined)
      payload.replacement_period_months = input.replacementPeriodMonths;
    if (input.isRequired !== undefined) payload.is_required = input.isRequired;
    if (input.quantityPerChange !== undefined)
      payload.quantity_per_change = input.quantityPerChange;
    if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_filter_assignments")
      .update(payload)
      .eq("id", input.assignmentId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/productos/${input.productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function removeFilterAssignmentAction(input: {
  assignmentId: string;
  productId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_filter_assignments")
      .delete()
      .eq("id", input.assignmentId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/productos/${input.productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// COMPATIBILIDADES
// =============================================================================

export async function listFilterCompatibilities(): Promise<FilterCompatibility[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_filter_compatibilities")
    .select(
      "id, filter_a_id, filter_b_id, notes, filter_a:product_filters!product_filter_compatibilities_filter_a_id_fkey(name), filter_b:product_filters!product_filter_compatibilities_filter_b_id_fkey(name)",
    )
    .eq("company_id", session.company_id);
  type Row = {
    id: string;
    filter_a_id: string;
    filter_b_id: string;
    notes: string | null;
    filter_a: { name: string } | null;
    filter_b: { name: string } | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    filter_a_id: r.filter_a_id,
    filter_b_id: r.filter_b_id,
    filter_a_name: r.filter_a?.name ?? "—",
    filter_b_name: r.filter_b?.name ?? "—",
    notes: r.notes,
  }));
}

export async function addFilterCompatibilityAction(input: {
  filterAId: string;
  filterBId: string;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    if (input.filterAId === input.filterBId) {
      return { ok: false, error: "Los dos filtros tienen que ser distintos." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("product_filter_compatibilities").insert([
      {
        company_id: session.company_id,
        filter_a_id: input.filterAId,
        filter_b_id: input.filterBId,
        notes: input.notes?.trim() || null,
        created_by: session.user_id,
      },
      // Insertamos también la dirección inversa para que la consulta sea
      // simétrica desde cualquier filtro. Si ya existe, ignoramos.
      {
        company_id: session.company_id,
        filter_a_id: input.filterBId,
        filter_b_id: input.filterAId,
        notes: input.notes?.trim() || null,
        created_by: session.user_id,
      },
    ]);
    if (error && (error as { code?: string }).code !== "23505") {
      return { ok: false, error: error.message };
    }
    revalidatePath("/productos/filtros");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function removeFilterCompatibilityAction(
  compatId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Borrar también la dirección inversa
    const { data: row } = await admin
      .from("product_filter_compatibilities")
      .select("filter_a_id, filter_b_id")
      .eq("id", compatId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!row) return { ok: false, error: "Compatibilidad no encontrada." };

    const { filter_a_id, filter_b_id } = row as {
      filter_a_id: string;
      filter_b_id: string;
    };
    await admin
      .from("product_filter_compatibilities")
      .delete()
      .eq("company_id", session.company_id)
      .or(
        `and(filter_a_id.eq.${filter_a_id},filter_b_id.eq.${filter_b_id}),and(filter_a_id.eq.${filter_b_id},filter_b_id.eq.${filter_a_id})`,
      );

    revalidatePath("/productos/filtros");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Para un filtro dado, devuelve los IDs de los filtros compatibles
 * (que pueden sustituirlo si no hay stock). Lectura para todos.
 */
export async function listCompatibleFilters(filterId: string): Promise<string[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_filter_compatibilities")
    .select("filter_b_id")
    .eq("filter_a_id", filterId);
  return ((data ?? []) as Array<{ filter_b_id: string }>).map((r) => r.filter_b_id);
}
