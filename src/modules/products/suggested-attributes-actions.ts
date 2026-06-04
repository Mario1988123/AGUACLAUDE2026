"use server";
/**
 * Server actions para que el admin importe los atributos sugeridos del
 * catálogo global del sector agua a una categoría de su empresa.
 *
 * La idea es simple:
 *   1) El admin importó categorías estándar (importStandardWaterCategoriesAction).
 *   2) Entra en una categoría (ej. "Ósmosis 5 etapas") y pulsa "Precargar
 *      atributos sugeridos".
 *   3) Esta acción clona los `product_attributes_global` ligados a esa
 *      categoría (y, si la categoría es subcategoría, también los del padre)
 *      a `product_attributes` locales.
 *   4) A partir de ahí, los forms de crear/editar producto los leen con la
 *      `listAttributes(categoryId)` que ya existía.
 *
 * Idempotente: si una clave ya existe en `product_attributes` para la empresa
 * y categoría, se salta.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export interface SuggestedAttribute {
  key: string;
  name_es: string;
  data_type: "text" | "number" | "boolean" | "enum" | "dimension" | "date";
  unit: string | null;
  enum_values: string[] | null;
  is_critical: boolean;
  sort_order: number;
  /** True si ya está clonado en product_attributes de la empresa+categoría. */
  already_in_company: boolean;
}

/**
 * Lista los atributos SUGERIDOS para una categoría local. Incluye:
 *   - Atributos del catálogo global ligados a la category_key clonada.
 *   - Si la categoría local es subcategoría (cloned global tiene parent_key),
 *     también los del padre.
 * Para cada uno marca si ya está en `product_attributes` (clonado a local) o
 * sigue siendo solo sugerencia.
 */
export async function listSuggestedAttributesForCategory(
  categoryId: string,
): Promise<SuggestedAttribute[]> {
  const session = await requireSession();
  if (!session.company_id) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Resolver category_key global asociada (y parent_key si aplica).
  const { data: cat } = await admin
    .from("product_categories")
    .select("id, cloned_from_global_id")
    .eq("id", categoryId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!cat) return [];

  const clonedFrom = (cat as { cloned_from_global_id: string | null })
    .cloned_from_global_id;
  if (!clonedFrom) return [];

  const { data: gcat } = await admin
    .from("product_categories_global")
    .select("id, key, parent_key")
    .eq("id", clonedFrom)
    .maybeSingle();
  if (!gcat) return [];
  const g = gcat as { id: string; key: string; parent_key: string | null };

  const categoryKeys = g.parent_key ? [g.key, g.parent_key] : [g.key];

  // 2) Recopilar attribute_keys ligados a esos category_key.
  const { data: links } = await admin
    .from("product_attributes_global_categories")
    .select("attribute_key, category_key")
    .in("category_key", categoryKeys);

  const attributeKeys = Array.from(
    new Set(
      ((links ?? []) as Array<{ attribute_key: string }>).map(
        (l) => l.attribute_key,
      ),
    ),
  );

  if (attributeKeys.length === 0) return [];

  // 3) Leer la metadata de cada atributo global.
  const { data: attrs } = await admin
    .from("product_attributes_global")
    .select("key, name_es, data_type, unit, enum_values, sort_order, is_critical")
    .in("key", attributeKeys);

  const allAttrs = (attrs ?? []) as Array<{
    key: string;
    name_es: string;
    data_type: SuggestedAttribute["data_type"];
    unit: string | null;
    enum_values: string[] | null;
    sort_order: number;
    is_critical?: boolean;
  }>;

  // 4) Saber cuáles ya están clonados en product_attributes (por key + categoría local + empresa).
  const { data: locals } = await admin
    .from("product_attributes")
    .select("key, category_id")
    .eq("company_id", session.company_id)
    .eq("category_id", categoryId);
  const localKeys = new Set(
    ((locals ?? []) as Array<{ key: string }>).map((l) => l.key),
  );

  return allAttrs
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => ({
      key: a.key,
      name_es: a.name_es,
      data_type: a.data_type,
      unit: a.unit,
      enum_values: a.enum_values,
      is_critical: Boolean(a.is_critical),
      sort_order: a.sort_order,
      already_in_company: localKeys.has(a.key),
    }));
}

export type ImportAttributesResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Clona los atributos globales sugeridos para una categoría local a
 * `product_attributes` de la empresa. Idempotente. Solo admin.
 */
export async function importGlobalAttributesForCategoryAction(
  categoryId: string,
): Promise<ImportAttributesResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const suggested = await listSuggestedAttributesForCategory(categoryId);
    if (suggested.length === 0) {
      return { ok: false, error: "No hay atributos sugeridos para esta categoría." };
    }

    const toInsert = suggested.filter((s) => !s.already_in_company);
    if (toInsert.length === 0) {
      return { ok: true, inserted: 0, skipped: suggested.length };
    }

    // Necesitamos el id global del atributo para guardar cloned_from_global_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: globals } = await admin
      .from("product_attributes_global")
      .select("id, key")
      .in(
        "key",
        toInsert.map((t) => t.key),
      );
    const idByKey = new Map(
      ((globals ?? []) as Array<{ id: string; key: string }>).map((g) => [g.key, g.id]),
    );

    const rows = toInsert.map((s) => ({
      company_id: session.company_id,
      cloned_from_global_id: idByKey.get(s.key) ?? null,
      category_id: categoryId,
      key: s.key,
      name: s.name_es,
      data_type: s.data_type,
      unit: s.unit ?? null,
      enum_values: s.enum_values ?? null,
      default_visible: true,
      is_required: false,
      sort_order: s.sort_order,
      // is_critical es columna nueva (migración 20260604100700). Si todavía
      // no está aplicada el insert falla y reintentamos sin la columna.
      is_critical: s.is_critical,
    }));

    let inserted = 0;
    const { error } = await admin.from("product_attributes").insert(rows);
    if (error) {
      // Retry sin is_critical si la columna aún no existe en la BD.
      if (
        /is_critical/i.test(error.message ?? "") ||
        (error as { code?: string }).code === "42703"
      ) {
        const rowsNoCritical = rows.map(({ is_critical: _omit, ...rest }) => rest);
        const r2 = await admin.from("product_attributes").insert(rowsNoCritical);
        if (r2.error) return { ok: false, error: r2.error.message };
        inserted = rowsNoCritical.length;
      } else if ((error as { code?: string }).code === "23505") {
        // Choque con unique (company_id, category_id, key): otro user en
        // paralelo ya lo insertó. Lo tratamos como skipped.
        inserted = 0;
      } else {
        return { ok: false, error: error.message };
      }
    } else {
      inserted = rows.length;
    }

    revalidatePath("/configuracion/productos");
    revalidatePath("/productos/nuevo");
    return {
      ok: true,
      inserted,
      skipped: suggested.length - inserted,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
