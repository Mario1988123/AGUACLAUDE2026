"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Compatibilidad de EXTRAS del configurador de packs (tabla product_extra_targets).
 *
 * Un producto marcado con el rol `configurator_extra` (ver products.roles) declara
 * de qué CATEGORÍA(S) y/o de qué EQUIPO(S) concreto(s) es extra. Al montar un pack
 * (equipo principal + extras) se ofrecen solo los extras compatibles con el equipo
 * principal elegido (por su producto o por su categoría). Si un extra NO tiene
 * ningún objetivo definido, se considera GLOBAL (ofrecible en cualquier equipo),
 * igual que los "addons" de la calculadora de ahorro.
 */

export interface ExtraTargets {
  categoryIds: string[];
  equipmentProductIds: string[];
}

/** Lee los objetivos (categorías + equipos) de un producto extra. */
export async function listExtraTargets(productId: string): Promise<ExtraTargets> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("product_extra_targets")
    .select("target_category_id, target_equipment_product_id")
    .eq("extra_product_id", productId);
  if (error) {
    console.error("[listExtraTargets] select failed:", error.message);
    return { categoryIds: [], equipmentProductIds: [] };
  }
  const rows = (data ?? []) as Array<{
    target_category_id: string | null;
    target_equipment_product_id: string | null;
  }>;
  return {
    categoryIds: rows.map((r) => r.target_category_id).filter(Boolean) as string[],
    equipmentProductIds: rows
      .map((r) => r.target_equipment_product_id)
      .filter(Boolean) as string[],
  };
}

/**
 * Reemplaza los objetivos de un extra (borra + inserta). Solo admin / director.
 * Filtra company_id manualmente porque el admin client salta RLS.
 */
export async function setExtraTargetsAction(
  productId: string,
  input: ExtraTargets,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const canManage =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director") ||
      session.roles.includes("commercial_director");
    if (!canManage) return { ok: false, error: "Sin permisos" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // SEGURIDAD: el producto extra debe ser de tu empresa.
    const { data: prod } = await admin
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!prod) return { ok: false, error: "Producto no encontrado o de otra empresa" };

    // Borrar los objetivos actuales de este extra.
    const del = await admin
      .from("product_extra_targets")
      .delete()
      .eq("company_id", session.company_id)
      .eq("extra_product_id", productId);
    if (del.error) return { ok: false, error: del.error.message };

    const rows: Array<Record<string, unknown>> = [];
    for (const categoryId of new Set(input.categoryIds ?? [])) {
      rows.push({
        company_id: session.company_id,
        extra_product_id: productId,
        target_category_id: categoryId,
        target_equipment_product_id: null,
        created_by: session.user_id,
      });
    }
    for (const equipmentId of new Set(input.equipmentProductIds ?? [])) {
      rows.push({
        company_id: session.company_id,
        extra_product_id: productId,
        target_category_id: null,
        target_equipment_product_id: equipmentId,
        created_by: session.user_id,
      });
    }
    if (rows.length > 0) {
      const ins = await admin.from("product_extra_targets").insert(rows);
      if (ins.error) return { ok: false, error: ins.error.message };
    }
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/** Lista de equipos (kind='equipment') para el selector de objetivos y packs. */
export async function listEquipmentProducts(): Promise<
  Array<{ id: string; name: string; category_id: string | null }>
> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category_id")
    .eq("kind", "equipment")
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("[listEquipmentProducts] select failed:", error.message);
    return [];
  }
  return (data ?? []) as Array<{ id: string; name: string; category_id: string | null }>;
}

export interface ExtraOption {
  id: string;
  name: string;
  kind: string;
  category_id: string | null;
}

/**
 * Extras compatibles con un equipo principal, para el constructor de packs.
 * Un extra es compatible si:
 *   - tiene el rol `configurator_extra`, y
 *   - NO tiene ningún objetivo (=> global), O
 *   - alguno de sus objetivos apunta a este equipo o a su categoría.
 */
export async function listCompatibleExtras(input: {
  equipmentProductId: string | null;
  categoryId: string | null;
}): Promise<ExtraOption[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Si no nos dan categoría pero sí el equipo, la resolvemos de su ficha para
  // poder ofrecer también extras dirigidos "por categoría".
  let categoryId = input.categoryId;
  if (!categoryId && input.equipmentProductId) {
    const { data: eq } = await supabase
      .from("products")
      .select("category_id")
      .eq("id", input.equipmentProductId)
      .maybeSingle();
    categoryId = (eq as { category_id: string | null } | null)?.category_id ?? null;
  }

  // 1) Todos los productos con rol configurator_extra (activos, no borrados).
  const { data: extrasRaw, error } = await supabase
    .from("products")
    .select("id, name, kind, category_id")
    .contains("roles", ["configurator_extra"])
    .is("deleted_at", null)
    .order("name");
  if (error) {
    console.error("[listCompatibleExtras] select extras failed:", error.message);
    return [];
  }
  const extras = (extrasRaw ?? []) as ExtraOption[];
  if (extras.length === 0) return [];

  // Nunca ofrecer el propio equipo principal como su extra.
  const filteredExtras = extras.filter((e) => e.id !== input.equipmentProductId);
  const extraIds = filteredExtras.map((e) => e.id);

  // 2) Objetivos definidos de esos extras.
  const { data: targetsRaw } = await supabase
    .from("product_extra_targets")
    .select("extra_product_id, target_category_id, target_equipment_product_id")
    .in("extra_product_id", extraIds);
  const targets = (targetsRaw ?? []) as Array<{
    extra_product_id: string;
    target_category_id: string | null;
    target_equipment_product_id: string | null;
  }>;

  const byExtra = new Map<string, { cats: Set<string>; equips: Set<string> }>();
  for (const t of targets) {
    const entry = byExtra.get(t.extra_product_id) ?? {
      cats: new Set<string>(),
      equips: new Set<string>(),
    };
    if (t.target_category_id) entry.cats.add(t.target_category_id);
    if (t.target_equipment_product_id) entry.equips.add(t.target_equipment_product_id);
    byExtra.set(t.extra_product_id, entry);
  }

  return filteredExtras.filter((e) => {
    const def = byExtra.get(e.id);
    // Sin objetivos => global (ofrecible en cualquier equipo).
    if (!def || (def.cats.size === 0 && def.equips.size === 0)) return true;
    if (input.equipmentProductId && def.equips.has(input.equipmentProductId)) return true;
    if (categoryId && def.cats.has(categoryId)) return true;
    return false;
  });
}
