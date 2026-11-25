"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export interface GlobalCategory {
  id: string;
  key: string;
  parent_key: string | null;
  name_es: string;
  description_es: string | null;
  default_kind: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface GlobalAttribute {
  id: string;
  key: string;
  name_es: string;
  description_es: string | null;
  data_type: string;
  unit: string | null;
  enum_values: string[] | null;
  default_visible: boolean;
  sort_order: number;
  grupo?: string | null;
  is_critical?: boolean;
}

export interface GlobalExternalModel {
  id: string;
  brand: string;
  model: string;
  notes: string | null;
}

export async function listGlobalCategoriesAdmin(): Promise<GlobalCategory[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_categories_global")
    .select("id, key, parent_key, name_es, description_es, default_kind, icon, sort_order, is_active")
    .order("sort_order");
  return (data ?? []) as GlobalCategory[];
}

export async function listGlobalAttributesAdmin(): Promise<GlobalAttribute[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_attributes_global")
    .select("id, key, name_es, description_es, data_type, unit, enum_values, default_visible, sort_order")
    .order("sort_order");
  return (data ?? []) as GlobalAttribute[];
}

export async function listGlobalExternalModels(): Promise<GlobalExternalModel[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("external_equipment_models")
    .select("id, brand, model, notes")
    .is("company_id", null)
    .order("brand")
    .order("model");
  return (data ?? []) as GlobalExternalModel[];
}

/** Valores del enum app.product_kind (20260501121100_products.sql). */
const PRODUCT_KINDS = ["equipment", "spare_part", "accessory", "consumable", "service"];
/** Valores del enum app.attribute_data_type. */
const ATTRIBUTE_DATA_TYPES = ["text", "number", "boolean", "enum", "dimension", "date"];
/** CHECK product_attributes_global_grupo_check (20261126100000). */
const ATTRIBUTE_GRUPOS = ["fisicas", "electricas", "tecnicas", "extra"];
const RE_CLAVE = /^[A-Za-z0-9_-]{2,60}$/;

/** Revalida todas las pantallas del catálogo (lista, categorías, atributos…). */
function revalidarCatalogo() {
  revalidatePath("/superadmin/catalogo", "layout");
}

export async function upsertGlobalCategoryAction(input: {
  id?: string;
  key: string;
  name_es: string;
  description_es?: string;
  default_kind?: string;
  sort_order?: number;
  /** undefined = no tocar; null = raíz. */
  parent_key?: string | null;
  is_active?: boolean;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const key = input.key.trim();
  const name = input.name_es.trim();
  if (!input.id && !RE_CLAVE.test(key)) {
    throw new Error("La clave solo admite letras, números, guion y guion bajo (2 a 60).");
  }
  if (!name) throw new Error("El nombre es obligatorio.");
  const kind = input.default_kind ?? "equipment";
  if (!PRODUCT_KINDS.includes(kind)) throw new Error("Tipo por defecto no válido.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    name_es: name,
    description_es: input.description_es?.trim() || null,
    default_kind: kind,
    sort_order: input.sort_order ?? 0,
  };
  if (input.parent_key !== undefined) {
    const padre = input.parent_key?.trim() || null;
    if (padre && padre === key) throw new Error("Una categoría no puede colgar de sí misma.");
    if (padre) {
      // Solo dos niveles: la madre ha de ser raíz y esta no puede tener hijas.
      const { data: madre, error: eMadre } = await supabase
        .from("product_categories_global")
        .select("key, parent_key")
        .eq("key", padre)
        .maybeSingle();
      if (eMadre) throw eMadre;
      if (!madre) throw new Error("La categoría madre no existe.");
      if (madre.parent_key) throw new Error("La categoría madre ha de ser de primer nivel.");
      if (input.id) {
        const { count, error: eHijas } = await supabase
          .from("product_categories_global")
          .select("id", { count: "exact", head: true })
          .eq("parent_key", key);
        if (eHijas) throw eHijas;
        if ((count ?? 0) > 0) {
          throw new Error("Esta categoría tiene subcategorías: no puede colgar de otra.");
        }
      }
    }
    payload.parent_key = padre;
  }
  if (input.is_active !== undefined) payload.is_active = input.is_active;
  if (input.id) {
    const { error } = await supabase.from("product_categories_global").update(payload).eq("id", input.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("product_categories_global").insert({ ...payload, key });
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe una categoría con la clave «${key}».`);
      throw error;
    }
  }
  revalidarCatalogo();
}

/** Desactiva (NUNCA borra): productos y empresas siguen enlazados por la clave. */
export async function deleteGlobalCategoryAction(id: string): Promise<void> {
  await setGlobalCategoryActiveAction(id, false);
}

export async function setGlobalCategoryActiveAction(id: string, activa: boolean): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from("product_categories_global")
    .update({ is_active: activa })
    .eq("id", id);
  if (error) throw error;
  revalidarCatalogo();
}

export async function upsertGlobalAttributeAction(input: {
  id?: string;
  key: string;
  name_es: string;
  data_type?: string;
  unit?: string;
  sort_order?: number;
  /** Los campos siguientes: undefined = no tocar. */
  description_es?: string | null;
  grupo?: string | null;
  enum_values?: string[] | null;
  is_critical?: boolean;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const key = input.key.trim();
  const name = input.name_es.trim();
  if (!input.id && !RE_CLAVE.test(key)) {
    throw new Error("La clave solo admite letras, números, guion y guion bajo (2 a 60).");
  }
  if (!name) throw new Error("El nombre es obligatorio.");
  const dataType = input.data_type ?? "text";
  if (!ATTRIBUTE_DATA_TYPES.includes(dataType)) throw new Error("Tipo de dato no válido.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    name_es: name,
    data_type: dataType,
    unit: input.unit?.trim() || null,
    sort_order: input.sort_order ?? 0,
  };
  if (input.description_es !== undefined) payload.description_es = input.description_es?.trim() || null;
  if (input.grupo !== undefined) {
    const g = input.grupo || null;
    if (g && !ATTRIBUTE_GRUPOS.includes(g)) throw new Error("Grupo no válido.");
    payload.grupo = g;
  }
  if (input.enum_values !== undefined) {
    const valores = Array.from(
      new Set((input.enum_values ?? []).map((v) => v.trim()).filter(Boolean)),
    );
    if (dataType === "enum" && valores.length === 0) {
      throw new Error("Una lista de valores necesita al menos un valor.");
    }
    payload.enum_values = dataType === "enum" ? valores : null;
  }
  if (input.is_critical !== undefined) payload.is_critical = input.is_critical;
  if (input.id) {
    const { error } = await supabase.from("product_attributes_global").update(payload).eq("id", input.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("product_attributes_global").insert({ ...payload, key });
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe un atributo con la clave «${key}».`);
      throw error;
    }
  }
  revalidarCatalogo();
}

/**
 * Borra un atributo global. Se niega si algún producto del maestro lo usa: el
 * borrado arrastraría (on delete cascade) sus valores en catalog_product_attributes.
 */
export async function deleteGlobalAttributeAction(id: string): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: attr, error: eAttr } = await supabase
    .from("product_attributes_global")
    .select("key")
    .eq("id", id)
    .maybeSingle();
  if (eAttr) throw eAttr;
  if (!attr) throw new Error("El atributo ya no existe.");
  const { count, error: eUso } = await supabase
    .from("catalog_product_attributes")
    .select("id", { count: "exact", head: true })
    .eq("attribute_global_key", attr.key);
  if (eUso) throw eUso;
  if ((count ?? 0) > 0) {
    throw new Error(
      `Lo usan ${count} productos del maestro: borrarlo se llevaría sus valores. Quítalo antes de esas fichas.`,
    );
  }
  const { error } = await supabase.from("product_attributes_global").delete().eq("id", id);
  if (error) throw error;
  revalidarCatalogo();
}

/**
 * Devuelve los keys de categorías a las que se aplica un atributo dado.
 */
export async function getAttributeCategoryKeys(attributeKey: string): Promise<string[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("product_attributes_global_categories")
    .select("category_key")
    .eq("attribute_key", attributeKey);
  return ((data ?? []) as Array<{ category_key: string }>).map((r) => r.category_key);
}

/**
 * Reemplaza la lista de categorías a las que aplica este atributo
 * (DELETE de las que sobran + INSERT de las nuevas).
 */
export async function setAttributeCategoriesAction(
  attributeKey: string,
  categoryKeys: string[],
): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const desired = Array.from(new Set(categoryKeys));
  const { data: current, error: eActual } = await supabase
    .from("product_attributes_global_categories")
    .select("category_key")
    .eq("attribute_key", attributeKey);
  if (eActual) throw eActual;
  const currentKeys = ((current ?? []) as Array<{ category_key: string }>).map((r) => r.category_key);
  const toDelete = currentKeys.filter((k) => !desired.includes(k));
  const toInsert = desired.filter((k) => !currentKeys.includes(k));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("product_attributes_global_categories")
      .delete()
      .eq("attribute_key", attributeKey)
      .in("category_key", toDelete);
    if (error) throw error;
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from("product_attributes_global_categories").insert(
      toInsert.map((k) => ({ attribute_key: attributeKey, category_key: k })),
    );
    if (error) throw error;
  }
  revalidarCatalogo();
}

export async function upsertExternalModelAction(input: {
  id?: string;
  brand: string;
  model: string;
  notes?: string;
}): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const payload = {
    brand: input.brand.trim(),
    model: input.model.trim(),
    notes: input.notes ?? null,
    company_id: null,
  };
  if (input.id) {
    const { error } = await supabase.from("external_equipment_models").update(payload).eq("id", input.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("external_equipment_models").insert(payload);
    if (error) throw error;
  }
  revalidarCatalogo();
}

export async function deleteExternalModelAction(id: string): Promise<void> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("external_equipment_models").delete().eq("id", id);
  if (error) throw error;
  revalidarCatalogo();
}

// =================== Safe wrappers ===================

export async function upsertGlobalCategorySafeAction(input: {
  id?: string;
  key: string;
  name_es: string;
  description_es?: string;
  default_kind?: string;
  sort_order?: number;
  parent_key?: string | null;
  is_active?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertGlobalCategoryAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function deleteGlobalCategorySafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteGlobalCategoryAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function upsertGlobalAttributeSafeAction(input: {
  id?: string;
  key: string;
  name_es: string;
  data_type?: string;
  unit?: string;
  sort_order?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertGlobalAttributeAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function setGlobalCategoryActiveSafeAction(
  id: string,
  activa: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setGlobalCategoryActiveAction(id, activa);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Guarda el atributo y sus categorías de una vez (pantalla de Atributos).
 * Si falla la segunda parte, el atributo ya queda guardado y el mensaje lo dice.
 */
export async function guardarAtributoGlobalSafeAction(input: {
  id?: string;
  key: string;
  name_es: string;
  description_es: string | null;
  data_type: string;
  unit: string;
  grupo: string | null;
  enum_values: string[] | null;
  sort_order: number;
  categorias: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { categorias, ...atributo } = input;
  try {
    await upsertGlobalAttributeAction(atributo);
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
  try {
    await setAttributeCategoriesAction(input.key.trim(), categorias);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `El atributo se ha guardado, pero no sus categorías: ${toActionError(e)}`,
    };
  }
}

export async function deleteGlobalAttributeSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteGlobalAttributeAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function setAttributeCategoriesSafeAction(
  attributeKey: string,
  categoryKeys: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setAttributeCategoriesAction(attributeKey, categoryKeys);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function upsertExternalModelSafeAction(input: {
  id?: string;
  brand: string;
  model: string;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertExternalModelAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function deleteExternalModelSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteExternalModelAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
