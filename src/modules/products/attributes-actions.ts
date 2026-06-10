"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface ProductAttribute {
  id: string;
  category_id: string | null;
  key: string;
  name: string;
  data_type: "text" | "number" | "boolean" | "enum" | "dimension" | "date";
  unit: string | null;
  enum_values: string[] | null;
  is_required: boolean;
  sort_order: number;
}

export interface ProductAttrValue {
  id: string;
  product_id: string;
  attribute_id: string;
  attribute_name: string;
  attribute_unit: string | null;
  data_type: ProductAttribute["data_type"];
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  is_visible: boolean;
  is_featured: boolean;
  display_order: number;
}

const attributeUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional().nullable(),
  key: z.string().min(2),
  name: z.string().min(2),
  data_type: z.enum(["text", "number", "boolean", "enum", "dimension", "date"]).default("text"),
  unit: z.string().optional().default(""),
  enum_values: z.array(z.string()).optional(),
  is_required: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).default(0),
});

const valueUpsertSchema = z.object({
  product_id: z.string().uuid(),
  attribute_id: z.string().uuid(),
  value_text: z.string().optional().nullable(),
  value_number: z.number().optional().nullable(),
  value_boolean: z.boolean().optional().nullable(),
  is_visible: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  display_order: z.coerce.number().int().min(0).default(0),
});

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function listAttributes(categoryId?: string | null): Promise<ProductAttribute[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Atributos EXTRA asignados a esta categoría vía tabla puente
  // (product_attribute_categories). Un atributo puede aplicar a varias
  // categorías además de su categoría principal. Defensivo: si la tabla
  // (migración 20260609100000) aún no está, seguimos sin ella.
  let extraAttrIds: string[] = [];
  if (categoryId) {
    const { data: bridge, error: bErr } = await supabase
      .from("product_attribute_categories")
      .select("attribute_id")
      .eq("category_id", categoryId);
    if (!bErr) {
      extraAttrIds = ((bridge ?? []) as Array<{ attribute_id: string }>).map(
        (r) => r.attribute_id,
      );
    }
  }

  const select =
    "id, category_id, key, name, data_type, unit, enum_values, is_required, sort_order";
  if (!categoryId) {
    const { data } = await supabase.from("product_attributes").select(select).order("sort_order");
    return (data ?? []) as ProductAttribute[];
  }

  // category_id = X  OR  category_id IS NULL  OR  id IN (extra de la puente)
  const orParts = [`category_id.eq.${categoryId}`, "category_id.is.null"];
  if (extraAttrIds.length > 0) orParts.push(`id.in.(${extraAttrIds.join(",")})`);
  const { data } = await supabase
    .from("product_attributes")
    .select(select)
    .or(orParts.join(","))
    .order("sort_order");
  return (data ?? []) as ProductAttribute[];
}

export async function listProductAttributeValues(productId: string): Promise<ProductAttrValue[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: rows } = await supabase
    .from("product_attribute_values")
    .select(
      "id, product_id, attribute_id, value_text, value_number, value_boolean, is_visible, is_featured, display_order",
    )
    .eq("product_id", productId)
    .order("display_order");
  type R = {
    id: string;
    product_id: string;
    attribute_id: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    is_visible: boolean;
    is_featured: boolean;
    display_order: number;
  };
  const list = (rows ?? []) as R[];
  if (list.length === 0) return [];
  const ids = list.map((r) => r.attribute_id);
  const { data: attrs } = await supabase
    .from("product_attributes")
    .select("id, name, data_type, unit")
    .in("id", ids);
  type A = {
    id: string;
    name: string;
    data_type: ProductAttribute["data_type"];
    unit: string | null;
  };
  const aMap = new Map(((attrs ?? []) as A[]).map((a) => [a.id, a]));
  return list.map((r) => {
    const a = aMap.get(r.attribute_id);
    return {
      ...r,
      attribute_name: a?.name ?? "?",
      attribute_unit: a?.unit ?? null,
      data_type: a?.data_type ?? "text",
    };
  });
}

/** Traduce el error de BD al guardar un atributo a un mensaje legible. El
 *  caso típico: el identificador (key) ya existe en esa categoría — pasa
 *  mucho cuando la categoría trae atributos precargados del catálogo global
 *  y se intenta añadir uno con el mismo nombre. */
function friendlyAttrError(
  error: { code?: string; message?: string } | null,
  key: string,
): string {
  if (
    error?.code === "23505" ||
    /duplicate key|unique/i.test(error?.message ?? "")
  ) {
    return `Ya existe una característica con el identificador «${key}» en esta categoría. Cámbiale el nombre o edita la que ya hay.`;
  }
  return error?.message || "No se pudo guardar la característica.";
}

export async function upsertAttributeAction(input: unknown): Promise<string | undefined> {
  const session = await ensureAdmin();
  const parsed = parseOrFriendly(attributeUpsertSchema, input, "Atributo producto");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = {
    company_id: session.company_id,
    category_id: parsed.category_id ?? null,
    key: parsed.key,
    name: parsed.name,
    data_type: parsed.data_type,
    unit: parsed.unit || null,
    enum_values: parsed.enum_values ?? null,
    is_required: parsed.is_required,
    sort_order: parsed.sort_order,
  };
  let id = parsed.id;
  if (parsed.id) {
    // ANTES: el error del update se ignoraba → fallo silencioso.
    const { error } = await admin
      .from("product_attributes")
      .update(payload)
      .eq("id", parsed.id);
    if (error) throw new Error(friendlyAttrError(error, parsed.key));
  } else {
    // ANTES: solo se leía `data`, no `error`. Si el insert chocaba con
    // unique(company_id, category_id, key), `data` venía null, `id`
    // quedaba undefined y NO se lanzaba nada: la UI decía "Guardado" pero
    // no guardaba. Ahora comprobamos el error y avisamos claro.
    const { data, error } = await admin
      .from("product_attributes")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(friendlyAttrError(error, parsed.key));
    id = (data as { id: string } | null)?.id;
  }
  revalidatePath("/configuracion/productos");
  return id;
}

/**
 * Categorías EXTRA (además de la principal) a las que aplica un atributo,
 * leídas de la tabla puente product_attribute_categories. Defensivo: si la
 * migración 20260609100000 no está aplicada, devuelve [].
 */
export async function listAttributeExtraCategories(attributeId: string): Promise<string[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("product_attribute_categories")
    .select("category_id")
    .eq("attribute_id", attributeId);
  if (error) return [];
  return ((data ?? []) as Array<{ category_id: string }>).map((r) => r.category_id);
}

/** Todas las vinculaciones atributo↔categoría extra de la empresa. Defensivo. */
export async function listAttributeCategoryLinks(): Promise<
  Array<{ attribute_id: string; category_id: string }>
> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("product_attribute_categories")
    .select("attribute_id, category_id");
  if (error) return [];
  return (data ?? []) as Array<{ attribute_id: string; category_id: string }>;
}

/**
 * Fija el conjunto de categorías EXTRA de un atributo (reemplaza las suyas,
 * no toca las de otros atributos). Solo admin. Defensivo si la tabla no existe.
 */
export async function setAttributeExtraCategoriesAction(
  attributeId: string,
  categoryIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Borrar las vinculaciones EXTRA actuales de ESTE atributo (solo las suyas).
    const del = await admin
      .from("product_attribute_categories")
      .delete()
      .eq("attribute_id", attributeId);
    if (del.error) {
      // Tabla aún no existe → no rompemos; lo dejamos como no-op.
      if (/(does not exist|schema cache|Could not find|relation)/i.test(del.error.message ?? "")) {
        return { ok: true };
      }
      return { ok: false, error: del.error.message };
    }

    const clean = Array.from(new Set(categoryIds.filter(Boolean)));
    if (clean.length > 0) {
      const rows = clean.map((category_id) => ({
        attribute_id: attributeId,
        category_id,
        company_id: session.company_id,
      }));
      const ins = await admin.from("product_attribute_categories").insert(rows);
      if (ins.error) return { ok: false, error: ins.error.message };
    }
    revalidatePath("/configuracion/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setProductAttributeValue(input: unknown) {
  const session = await ensureAdmin();
  const parsed = parseOrFriendly(valueUpsertSchema, input, "Valor atributo");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Validar máx 5 destacados (decisión prompt)
  if (parsed.is_featured) {
    const { count } = await admin
      .from("product_attribute_values")
      .select("id", { count: "exact", head: true })
      .eq("product_id", parsed.product_id)
      .eq("is_featured", true)
      .neq("attribute_id", parsed.attribute_id);
    if ((count ?? 0) >= 5)
      throw new Error("Máximo 5 atributos destacados por producto");
  }

  const { data: existing } = await admin
    .from("product_attribute_values")
    .select("id")
    .eq("product_id", parsed.product_id)
    .eq("attribute_id", parsed.attribute_id)
    .maybeSingle();

  const payload = {
    product_id: parsed.product_id,
    attribute_id: parsed.attribute_id,
    company_id: session.company_id,
    value_text: parsed.value_text ?? null,
    value_number: parsed.value_number ?? null,
    value_boolean: parsed.value_boolean ?? null,
    is_visible: parsed.is_visible,
    is_featured: parsed.is_featured,
    display_order: parsed.display_order,
  };
  if (existing) {
    await admin
      .from("product_attribute_values")
      .update(payload)
      .eq("id", (existing as { id: string }).id);
  } else {
    await admin.from("product_attribute_values").insert(payload);
  }
  revalidatePath(`/productos/${parsed.product_id}`);
}

export async function deleteProductAttributeValue(id: string, productId: string) {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("product_attribute_values").delete().eq("id", id);
  revalidatePath(`/productos/${productId}`);
}

// =================== Safe wrappers ===================

export async function setProductAttributeValueSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setProductAttributeValue(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteProductAttributeValueSafeAction(
  id: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteProductAttributeValue(id, productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function upsertAttributeSafeAction(
  input: unknown,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  try {
    const id = await upsertAttributeAction(input);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
