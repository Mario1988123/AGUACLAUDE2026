"use server";
/**
 * Catálogo maestro — PRODUCTOS (solo superadmin).
 * Mismos campos que el alta normal MENOS precio y stock. Usa las categorías y
 * atributos GLOBALES (product_categories_global / product_attributes_global).
 * Llave de cruce con las empresas: supplier_reference (única).
 *
 * `version` sube en cada cambio (basics/atributos/fotos/docs) para que las
 * empresas enganchadas reciban el aviso de "actualización disponible".
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket, pickImageExt } from "@/shared/lib/supabase/storage-buckets";
import type { ProductDocKind } from "@/modules/products/documents-constants";

const BUCKET = "catalog-global";

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bumpVersion(admin: any, id: string): Promise<void> {
  const { data } = await admin
    .from("catalog_products")
    .select("version")
    .eq("id", id)
    .maybeSingle();
  const v = ((data as { version: number } | null)?.version ?? 1) + 1;
  await admin.from("catalog_products").update({ version: v }).eq("id", id);
}

// =============================================================================
// Tipos
// =============================================================================

export interface GlobalCategoryOption {
  key: string;
  name_es: string;
  default_kind: string;
}

export interface GlobalAttributeForm {
  key: string;
  name_es: string;
  data_type: string;
  unit: string | null;
  enum_values: string[] | null;
  is_required: boolean;
}

export interface CatalogProductListItem {
  id: string;
  name: string;
  supplier_reference: string;
  kind: string;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  category_global_key: string | null;
  is_active: boolean;
  version: number;
}

export interface CatalogAttrValue {
  attribute_global_key: string;
  name_es: string;
  data_type: string;
  unit: string | null;
  enum_values: string[] | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
}

export interface CatalogPhoto {
  id: string;
  storage_path: string;
  is_main: boolean;
  display_order: number;
  url: string | null;
}

export interface CatalogDoc {
  id: string;
  kind: ProductDocKind;
  title: string;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
}

export interface CatalogProductDetail {
  id: string;
  manufacturer_id: string | null;
  supplier_reference: string;
  name: string;
  kind: string;
  category_global_key: string | null;
  short_description: string | null;
  long_description: string | null;
  dim_width_mm: number | null;
  dim_height_mm: number | null;
  dim_depth_mm: number | null;
  weight_grams: number | null;
  version: number;
  is_active: boolean;
  attributes: CatalogAttrValue[];
  photos: CatalogPhoto[];
  documents: CatalogDoc[];
}

// =============================================================================
// Lecturas auxiliares (categorías + atributos globales)
// =============================================================================

export async function listGlobalCategoryOptions(): Promise<GlobalCategoryOption[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("product_categories_global")
    .select("key, name_es, default_kind, is_active, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  return ((data ?? []) as Array<GlobalCategoryOption & { is_active: boolean }>).map((c) => ({
    key: c.key,
    name_es: c.name_es,
    default_kind: c.default_kind,
  }));
}

/** Atributos globales aplicables a una categoría (por key). Si no se pasa
 *  categoría, devuelve []. */
export async function listGlobalAttributesForCategory(
  categoryKey: string | null,
): Promise<GlobalAttributeForm[]> {
  await ensureSuperadmin();
  if (!categoryKey) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: links } = await admin
    .from("product_attributes_global_categories")
    .select("attribute_key, is_required")
    .eq("category_key", categoryKey);
  const linkRows = (links ?? []) as Array<{ attribute_key: string; is_required: boolean }>;
  if (linkRows.length === 0) return [];
  const reqMap = new Map(linkRows.map((l) => [l.attribute_key, l.is_required]));
  const { data: attrs } = await admin
    .from("product_attributes_global")
    .select("key, name_es, data_type, unit, enum_values, sort_order")
    .in("key", Array.from(reqMap.keys()))
    .order("sort_order");
  return ((attrs ?? []) as Array<Omit<GlobalAttributeForm, "is_required">>).map((a) => ({
    ...a,
    is_required: reqMap.get(a.key) ?? false,
  }));
}

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "attr"
  );
}

/**
 * Crea un atributo GLOBAL nuevo y lo engancha a la categoría indicada (para que
 * a partir de ahora salga en todos los productos de esa categoría). Lo usa el
 * formulario de producto maestro: "añadir atributo" que migra a la categoría.
 */
export async function createGlobalAttributeForCategoryAction(input: {
  categoryKey: string;
  name: string;
  dataType?: string;
  unit?: string;
}): Promise<{ ok: true; attribute: GlobalAttributeForm } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Escribe el nombre del atributo" };
    if (!input.categoryKey) return { ok: false, error: "Elige una categoría primero" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const VALID = ["text", "number", "boolean", "enum", "dimension", "date"];
    const dataType = input.dataType && VALID.includes(input.dataType) ? input.dataType : "text";
    const unit = input.unit?.trim() || null;

    // key única
    const base = slugify(name);
    let key = base;
    let n = 1;
    for (;;) {
      const { data: ex } = await admin
        .from("product_attributes_global")
        .select("key")
        .eq("key", key)
        .maybeSingle();
      if (!ex) break;
      n += 1;
      key = `${base}_${n}`;
      if (n > 50) break;
    }

    const { error } = await admin.from("product_attributes_global").insert({
      key,
      name_es: name,
      data_type: dataType,
      unit,
    });
    if (error) return { ok: false, error: error.message };

    const { error: linkErr } = await admin
      .from("product_attributes_global_categories")
      .insert({ attribute_key: key, category_key: input.categoryKey, is_required: false });
    if (linkErr && !/duplicate|unique/i.test(linkErr.message ?? "")) {
      return { ok: false, error: linkErr.message };
    }

    revalidatePath("/superadmin/catalogo");
    return {
      ok: true,
      attribute: {
        key,
        name_es: name,
        data_type: dataType,
        unit,
        enum_values: null,
        is_required: false,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// Lectura de productos maestros
// =============================================================================

export async function listCatalogProducts(filters?: {
  manufacturerId?: string;
  search?: string;
}): Promise<CatalogProductListItem[]> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let q = admin
    .from("catalog_products")
    .select(
      "id, name, supplier_reference, kind, manufacturer_id, category_global_key, is_active, version",
    )
    .order("name");
  if (filters?.manufacturerId) q = q.eq("manufacturer_id", filters.manufacturerId);
  if (filters?.search) {
    const s = filters.search.replace(/[%_]/g, "");
    q = q.or(`name.ilike.%${s}%,supplier_reference.ilike.%${s}%`);
  }
  const { data } = await q;
  const rows = (data ?? []) as Array<Omit<CatalogProductListItem, "manufacturer_name">>;
  // Resolver nombres de fabricante por id (sin embeds → robusto).
  const ids = Array.from(new Set(rows.map((r) => r.manufacturer_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: mans } = await admin.from("manufacturers").select("id, name").in("id", ids);
    for (const m of (mans ?? []) as Array<{ id: string; name: string }>) nameById.set(m.id, m.name);
  }
  return rows.map((r) => ({
    ...r,
    manufacturer_name: r.manufacturer_id ? nameById.get(r.manufacturer_id) ?? null : null,
  }));
}

export async function getCatalogProduct(id: string): Promise<CatalogProductDetail | null> {
  await ensureSuperadmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: p } = await admin
    .from("catalog_products")
    .select(
      "id, manufacturer_id, supplier_reference, name, kind, category_global_key, short_description, long_description, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, version, is_active",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  const prod = p as Omit<CatalogProductDetail, "attributes" | "photos" | "documents">;

  // Atributos (valores) + datos del atributo global
  const { data: avRows } = await admin
    .from("catalog_product_attributes")
    .select("attribute_global_key, value_text, value_number, value_boolean, display_order")
    .eq("catalog_product_id", id)
    .order("display_order");
  const av = (avRows ?? []) as Array<{
    attribute_global_key: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
  }>;
  const attrMeta = new Map<
    string,
    { name_es: string; data_type: string; unit: string | null; enum_values: string[] | null }
  >();
  if (av.length > 0) {
    const { data: metas } = await admin
      .from("product_attributes_global")
      .select("key, name_es, data_type, unit, enum_values")
      .in(
        "key",
        av.map((a) => a.attribute_global_key),
      );
    for (const m of (metas ?? []) as Array<{
      key: string;
      name_es: string;
      data_type: string;
      unit: string | null;
      enum_values: string[] | null;
    }>)
      attrMeta.set(m.key, m);
  }
  const attributes: CatalogAttrValue[] = av.map((a) => {
    const m = attrMeta.get(a.attribute_global_key);
    return {
      attribute_global_key: a.attribute_global_key,
      name_es: m?.name_es ?? a.attribute_global_key,
      data_type: m?.data_type ?? "text",
      unit: m?.unit ?? null,
      enum_values: m?.enum_values ?? null,
      value_text: a.value_text,
      value_number: a.value_number,
      value_boolean: a.value_boolean,
    };
  });

  // Fotos (con URL firmada)
  const { data: photoRows } = await admin
    .from("catalog_product_photos")
    .select("id, storage_path, is_main, display_order")
    .eq("catalog_product_id", id)
    .order("is_main", { ascending: false })
    .order("display_order");
  const photos: CatalogPhoto[] = [];
  for (const ph of (photoRows ?? []) as Array<Omit<CatalogPhoto, "url">>) {
    let url: string | null = null;
    try {
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(ph.storage_path, 3600);
      url = (signed as { signedUrl: string } | null)?.signedUrl ?? null;
    } catch {
      /* ignore */
    }
    photos.push({ ...ph, url });
  }

  // Documentos
  const { data: docRows } = await admin
    .from("catalog_product_documents")
    .select("id, kind, title, storage_path, file_size_bytes, mime_type, display_order")
    .eq("catalog_product_id", id)
    .order("display_order")
    .order("created_at", { ascending: false });
  const documents = (docRows ?? []) as CatalogDoc[];

  return { ...prod, attributes, photos, documents };
}

export async function getCatalogFileUrlAction(
  storagePath: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
    if (error) return { ok: false, error: error.message };
    return { ok: true, url: (data as { signedUrl: string }).signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// Escritura: alta / edición / borrado
// =============================================================================

export interface CatalogProductInput {
  manufacturer_id?: string | null;
  supplier_reference: string;
  name: string;
  kind: string;
  category_global_key?: string | null;
  short_description?: string | null;
  long_description?: string | null;
  dim_width_mm?: number | null;
  dim_height_mm?: number | null;
  dim_depth_mm?: number | null;
  weight_grams?: number | null;
}

function basicsPayload(input: CatalogProductInput): Record<string, unknown> {
  return {
    manufacturer_id: input.manufacturer_id || null,
    name: input.name.trim(),
    kind: input.kind || "equipment",
    category_global_key: input.category_global_key || null,
    short_description: input.short_description?.trim() || null,
    long_description: input.long_description?.trim() || null,
    dim_width_mm: input.dim_width_mm ?? null,
    dim_height_mm: input.dim_height_mm ?? null,
    dim_depth_mm: input.dim_depth_mm ?? null,
    weight_grams: input.weight_grams ?? null,
  };
}

export async function createCatalogProductSafeAction(
  input: CatalogProductInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureSuperadmin();
    if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio" };
    const ref = input.supplier_reference.trim();
    if (!ref)
      return { ok: false, error: "La referencia del proveedor es obligatoria (es la llave)" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload = {
      ...basicsPayload(input),
      supplier_reference: ref,
      created_by: session.user_id,
    };
    const { data, error } = await admin
      .from("catalog_products")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (/uniq_catalog_products_supplier_ref|duplicate/i.test(error.message ?? "")) {
        return {
          ok: false,
          error: `Ya existe un producto maestro con la referencia "${ref}".`,
        };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/superadmin/catalogo/productos");
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function updateCatalogProductSafeAction(
  id: string,
  input: CatalogProductInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    if (!input.name.trim()) return { ok: false, error: "El nombre es obligatorio" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // OJO: la referencia del proveedor NO se cambia desde la edición normal
    // (es la llave de cruce). Solo basics + categoría.
    const { error } = await admin.from("catalog_products").update(basicsPayload(input)).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await bumpVersion(admin, id);
    revalidatePath("/superadmin/catalogo/productos");
    revalidatePath(`/superadmin/catalogo/productos/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteCatalogProductSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("catalog_products").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/catalogo/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export interface AttrValueInput {
  attribute_global_key: string;
  value_text?: string | null;
  value_number?: number | null;
  value_boolean?: boolean | null;
}

export async function setCatalogProductAttributesSafeAction(
  id: string,
  values: AttrValueInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Reemplazo total: borrar las que no vienen + upsert de las que vienen.
    await admin.from("catalog_product_attributes").delete().eq("catalog_product_id", id);
    const rows = values
      .filter(
        (v) =>
          (v.value_text != null && v.value_text !== "") ||
          v.value_number != null ||
          v.value_boolean != null,
      )
      .map((v, i) => ({
        catalog_product_id: id,
        attribute_global_key: v.attribute_global_key,
        value_text: v.value_text ?? null,
        value_number: v.value_number ?? null,
        value_boolean: v.value_boolean ?? null,
        display_order: i,
      }));
    if (rows.length > 0) {
      const { error } = await admin.from("catalog_product_attributes").insert(rows);
      if (error) return { ok: false, error: error.message };
    }
    await bumpVersion(admin, id);
    revalidatePath(`/superadmin/catalogo/productos/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// Fotos
// =============================================================================

export async function uploadCatalogPhotoAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    const id = String(formData.get("catalog_product_id") ?? "").trim();
    const file = formData.get("file");
    if (!id) return { ok: false, error: "Falta el producto" };
    if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };
    if (file.size > 8 * 1024 * 1024)
      return { ok: false, error: "Imagen demasiado grande (máx 8 MB)" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ready = await ensureBucket(admin, BUCKET);
    if (!ready) return { ok: false, error: "No se pudo preparar el almacén" };
    const ext = pickImageExt({ name: file.name, type: file.type });
    const path = `products/${id}/photo-${Date.now()}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type || "image/jpeg", upsert: false });
    if (upErr) return { ok: false, error: upErr.message };
    // ¿es la primera foto? marcarla como principal
    const { data: existing } = await admin
      .from("catalog_product_photos")
      .select("id")
      .eq("catalog_product_id", id)
      .limit(1);
    const isFirst = (existing ?? []).length === 0;
    const { error } = await admin.from("catalog_product_photos").insert({
      catalog_product_id: id,
      storage_path: path,
      is_main: isFirst,
    });
    if (error) return { ok: false, error: error.message };
    if (isFirst) {
      await admin.from("catalog_products").update({ main_image_path: path }).eq("id", id);
    }
    await bumpVersion(admin, id);
    revalidatePath(`/superadmin/catalogo/productos/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteCatalogPhotoSafeAction(
  photoId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: ph } = await admin
      .from("catalog_product_photos")
      .select("storage_path, is_main")
      .eq("id", photoId)
      .maybeSingle();
    const { error } = await admin.from("catalog_product_photos").delete().eq("id", photoId);
    if (error) return { ok: false, error: error.message };
    if (ph) {
      try {
        await admin.storage.from(BUCKET).remove([(ph as { storage_path: string }).storage_path]);
      } catch {
        /* ignore */
      }
      if ((ph as { is_main: boolean }).is_main) {
        // promover otra a principal
        const { data: next } = await admin
          .from("catalog_product_photos")
          .select("id, storage_path")
          .eq("catalog_product_id", productId)
          .order("display_order")
          .limit(1);
        const n = (next ?? [])[0] as { id: string; storage_path: string } | undefined;
        if (n) {
          await admin.from("catalog_product_photos").update({ is_main: true }).eq("id", n.id);
          await admin
            .from("catalog_products")
            .update({ main_image_path: n.storage_path })
            .eq("id", productId);
        } else {
          await admin.from("catalog_products").update({ main_image_path: null }).eq("id", productId);
        }
      }
    }
    await bumpVersion(admin, productId);
    revalidatePath(`/superadmin/catalogo/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setMainCatalogPhotoSafeAction(
  photoId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin
      .from("catalog_product_photos")
      .update({ is_main: false })
      .eq("catalog_product_id", productId);
    const { data: ph } = await admin
      .from("catalog_product_photos")
      .update({ is_main: true })
      .eq("id", photoId)
      .select("storage_path")
      .maybeSingle();
    if (ph) {
      await admin
        .from("catalog_products")
        .update({ main_image_path: (ph as { storage_path: string }).storage_path })
        .eq("id", productId);
    }
    await bumpVersion(admin, productId);
    revalidatePath(`/superadmin/catalogo/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// Documentos
// =============================================================================

export async function uploadCatalogDocumentAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureSuperadmin();
    const id = String(formData.get("catalog_product_id") ?? "").trim();
    const kind = String(formData.get("kind") ?? "other") as ProductDocKind;
    const title = String(formData.get("title") ?? "").trim();
    const file = formData.get("file");
    if (!id) return { ok: false, error: "Falta el producto" };
    if (!title) return { ok: false, error: "Falta el título" };
    if (!(file instanceof File)) return { ok: false, error: "Falta el archivo" };
    if (file.size > 9 * 1024 * 1024)
      return { ok: false, error: "Archivo demasiado grande (máx 9 MB)" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ready = await ensureBucket(admin, BUCKET);
    if (!ready) return { ok: false, error: "No se pudo preparar el almacén" };
    const safeName = file.name.replace(/[^a-z0-9.-]+/gi, "_").slice(0, 80);
    const path = `products/${id}/docs/${Date.now()}-${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) return { ok: false, error: upErr.message };
    const { error } = await admin.from("catalog_product_documents").insert({
      catalog_product_id: id,
      kind,
      title,
      storage_path: path,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      created_by: session.user_id,
    });
    if (error) return { ok: false, error: error.message };
    await bumpVersion(admin, id);
    revalidatePath(`/superadmin/catalogo/productos/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteCatalogDocumentSafeAction(
  documentId: string,
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: doc } = await admin
      .from("catalog_product_documents")
      .select("storage_path")
      .eq("id", documentId)
      .maybeSingle();
    const { error } = await admin
      .from("catalog_product_documents")
      .delete()
      .eq("id", documentId);
    if (error) return { ok: false, error: error.message };
    if (doc) {
      try {
        await admin.storage.from(BUCKET).remove([(doc as { storage_path: string }).storage_path]);
      } catch {
        /* ignore */
      }
    }
    await bumpVersion(admin, productId);
    revalidatePath(`/superadmin/catalogo/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
