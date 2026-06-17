"use server";
/**
 * FASE 3 — Alta de producto en la EMPRESA a partir del catálogo MAESTRO.
 *
 * Flujo: el admin teclea la referencia del proveedor. Si el superadmin tiene un
 * producto maestro con esa referencia, se le crea una COPIA propia con sus datos,
 * atributos, fotos y documentación (los ficheros se copian a los buckets de la
 * empresa: se queda su copia). Queda enganchado por catalog_product_id +
 * catalog_version_synced para los avisos de actualización (Fase 4).
 *
 * Las tablas del maestro tienen RLS solo-superadmin, por eso aquí se usa
 * service-role (createAdminClient). El producto creado es de la empresa.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";

const CATALOG_BUCKET = "catalog-global";
const IMAGES_BUCKET = "product-images";
const DOCS_BUCKET = "product-documents";

// PostgREST ilike trata % y _ como comodines; los escapamos para que la
// referencia se busque literal (insensible a may/min por el índice único).
function escLike(s: string): string {
  return s.replace(/([%_\\])/g, "\\$1");
}

async function requireAdmin() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin") && !session.is_superadmin)
    throw new Error("Solo admin puede crear productos");
  // Estrechar company_id a string (el guard de arriba lo garantiza).
  return { ...session, company_id: session.company_id as string };
}

// =============================================================================
// 1) Buscar (preview, no crea nada)
// =============================================================================

export type CatalogLookupResult =
  | { ok: true; found: false }
  | {
      ok: true;
      found: true;
      name: string;
      manufacturerName: string | null;
      alreadyOwnedId: string | null;
    }
  | { ok: false; error: string };

export async function lookupCatalogBySupplierRefAction(
  ref: string,
): Promise<CatalogLookupResult> {
  try {
    const session = await requireAdmin();
    const clean = ref.trim();
    if (!clean) return { ok: true, found: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: m } = await admin
      .from("catalog_products")
      .select("id, name, manufacturer_id, is_active")
      .ilike("supplier_reference", escLike(clean))
      .maybeSingle();
    if (!m || !(m as { is_active: boolean }).is_active) return { ok: true, found: false };
    const master = m as { id: string; name: string; manufacturer_id: string | null };

    const { data: existing } = await admin
      .from("products")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("catalog_product_id", master.id)
      .is("deleted_at", null)
      .maybeSingle();

    let manufacturerName: string | null = null;
    if (master.manufacturer_id) {
      const { data: man } = await admin
        .from("manufacturers")
        .select("name")
        .eq("id", master.manufacturer_id)
        .maybeSingle();
      manufacturerName = (man as { name: string } | null)?.name ?? null;
    }
    return {
      ok: true,
      found: true,
      name: master.name,
      manufacturerName,
      alreadyOwnedId: (existing as { id: string } | null)?.id ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =============================================================================
// 2) Importar (crea la copia de la empresa)
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveLocalCategory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  userId: string,
  globalKey: string,
): Promise<string | null> {
  const { data: gc } = await admin
    .from("product_categories_global")
    .select("id, name_es, default_kind, sort_order")
    .eq("key", globalKey)
    .maybeSingle();
  if (!gc) return null;
  const g = gc as { id: string; name_es: string; default_kind: string; sort_order: number };

  // ¿ya existe local clonada de esta global?
  const { data: byClone } = await admin
    .from("product_categories")
    .select("id")
    .eq("company_id", companyId)
    .eq("cloned_from_global_id", g.id)
    .maybeSingle();
  if (byClone) return (byClone as { id: string }).id;

  // ¿existe una con el mismo nombre? (unique company_id, name)
  const { data: byName } = await admin
    .from("product_categories")
    .select("id")
    .eq("company_id", companyId)
    .eq("name", g.name_es)
    .maybeSingle();
  if (byName) return (byName as { id: string }).id;

  const { data: ins, error } = await admin
    .from("product_categories")
    .insert({
      company_id: companyId,
      cloned_from_global_id: g.id,
      name: g.name_es,
      default_kind: g.default_kind,
      sort_order: g.sort_order,
      is_active: true,
      created_by: userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !ins) return null;
  return (ins as { id: string }).id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function copyAttributes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  masterId: string,
  productId: string,
  categoryId: string | null,
): Promise<void> {
  const { data: avRows } = await admin
    .from("catalog_product_attributes")
    .select("attribute_global_key, value_text, value_number, value_boolean, display_order")
    .eq("catalog_product_id", masterId)
    .order("display_order");
  const av = (avRows ?? []) as Array<{
    attribute_global_key: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    display_order: number;
  }>;
  if (av.length === 0) return;

  const { data: metas } = await admin
    .from("product_attributes_global")
    .select("id, key, name_es, data_type, unit, enum_values")
    .in(
      "key",
      av.map((a) => a.attribute_global_key),
    );
  const metaByKey = new Map(
    ((metas ?? []) as Array<{
      id: string;
      key: string;
      name_es: string;
      data_type: string;
      unit: string | null;
      enum_values: string[] | null;
    }>).map((m) => [m.key, m]),
  );

  for (const a of av) {
    const meta = metaByKey.get(a.attribute_global_key);
    if (!meta) continue;
    // localizar/clonar el atributo local
    let localId: string | null = null;
    let q = admin
      .from("product_attributes")
      .select("id")
      .eq("company_id", companyId)
      .eq("cloned_from_global_id", meta.id);
    q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);
    const { data: existing } = await q.maybeSingle();
    if (existing) {
      localId = (existing as { id: string }).id;
    } else {
      const { data: ins } = await admin
        .from("product_attributes")
        .insert({
          company_id: companyId,
          category_id: categoryId,
          cloned_from_global_id: meta.id,
          key: meta.key,
          name: meta.name_es,
          data_type: meta.data_type,
          unit: meta.unit,
          enum_values: meta.enum_values,
          default_visible: true,
        })
        .select("id")
        .maybeSingle();
      localId = (ins as { id: string } | null)?.id ?? null;
    }
    if (!localId) continue;
    await admin.from("product_attribute_values").insert({
      product_id: productId,
      attribute_id: localId,
      company_id: companyId,
      value_text: a.value_text,
      value_number: a.value_number,
      value_boolean: a.value_boolean,
      is_visible: true,
      is_featured: false,
      display_order: a.display_order,
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function copyPhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  masterId: string,
  productId: string,
): Promise<void> {
  const { data: rows } = await admin
    .from("catalog_product_photos")
    .select("storage_path, is_main, display_order")
    .eq("catalog_product_id", masterId)
    .order("is_main", { ascending: false })
    .order("display_order");
  const photos = (rows ?? []) as Array<{
    storage_path: string;
    is_main: boolean;
    display_order: number;
  }>;
  if (photos.length === 0) return;
  await ensureBucket(admin, IMAGES_BUCKET);

  let i = 0;
  for (const ph of photos) {
    try {
      const { data: blob } = await admin.storage.from(CATALOG_BUCKET).download(ph.storage_path);
      if (!blob) continue;
      const ext = ph.storage_path.split(".").pop()?.toLowerCase() || "jpg";
      const target = `${companyId}/${productId}/${i}.${ext}`;
      const buf = Buffer.from(await blob.arrayBuffer());
      const contentType = (blob as { type?: string }).type || "image/jpeg";
      const { error: upErr } = await admin.storage
        .from(IMAGES_BUCKET)
        .upload(target, buf, { contentType, upsert: true });
      if (upErr) continue;
      await admin.from("product_images").insert({
        company_id: companyId,
        product_id: productId,
        storage_path: target,
        is_main: ph.is_main,
        display_order: ph.display_order,
      });
      if (ph.is_main) {
        const { data: pub } = admin.storage.from(IMAGES_BUCKET).getPublicUrl(target);
        const url = (pub as { publicUrl: string }).publicUrl;
        await admin.from("products").update({ main_image_url: url }).eq("id", productId);
      }
      i += 1;
    } catch {
      /* foto que falla no bloquea el import */
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function copyDocuments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  userId: string,
  masterId: string,
  productId: string,
): Promise<void> {
  const { data: rows } = await admin
    .from("catalog_product_documents")
    .select("kind, title, storage_path, file_size_bytes, mime_type, display_order")
    .eq("catalog_product_id", masterId)
    .order("display_order");
  const docs = (rows ?? []) as Array<{
    kind: string;
    title: string;
    storage_path: string;
    file_size_bytes: number | null;
    mime_type: string | null;
    display_order: number;
  }>;
  if (docs.length === 0) return;
  await ensureBucket(admin, DOCS_BUCKET);

  for (const d of docs) {
    try {
      const { data: blob } = await admin.storage.from(CATALOG_BUCKET).download(d.storage_path);
      if (!blob) continue;
      const name = d.storage_path.split("/").pop() || "doc";
      const target = `${companyId}/${productId}/${Date.now()}-${name}`;
      const buf = Buffer.from(await blob.arrayBuffer());
      const contentType = d.mime_type || (blob as { type?: string }).type || "application/octet-stream";
      const { error: upErr } = await admin.storage
        .from(DOCS_BUCKET)
        .upload(target, buf, { contentType, upsert: false });
      if (upErr) continue;
      await admin.from("product_documents").insert({
        company_id: companyId,
        product_id: productId,
        kind: d.kind,
        title: d.title,
        storage_path: target,
        file_size_bytes: d.file_size_bytes,
        mime_type: d.mime_type,
        created_by: userId,
      });
    } catch {
      /* doc que falla no bloquea el import */
    }
  }
}

export type CatalogImportResult =
  | { ok: true; id: string }
  | { ok: false; error: string; existingId?: string };

export async function importCatalogProductSafeAction(
  ref: string,
): Promise<CatalogImportResult> {
  try {
    const session = await requireAdmin();
    const clean = ref.trim();
    if (!clean) return { ok: false, error: "Falta la referencia del proveedor" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: m } = await admin
      .from("catalog_products")
      .select(
        "id, manufacturer_id, supplier_reference, name, kind, category_global_key, short_description, long_description, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, version, is_active",
      )
      .ilike("supplier_reference", escLike(clean))
      .maybeSingle();
    if (!m || !(m as { is_active: boolean }).is_active) {
      return { ok: false, error: "Esa referencia no está en el catálogo del fabricante." };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const master = m as any;

    const { data: existing } = await admin
      .from("products")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("catalog_product_id", master.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      return {
        ok: false,
        error: "Ya tienes este producto importado del catálogo.",
        existingId: (existing as { id: string }).id,
      };
    }

    const categoryId = master.category_global_key
      ? await resolveLocalCategory(
          admin,
          session.company_id,
          session.user_id,
          master.category_global_key,
        )
      : null;

    const { data: created, error } = await admin
      .from("products")
      .insert({
        company_id: session.company_id,
        name: master.name,
        kind: master.kind,
        category_id: categoryId,
        supplier_reference: master.supplier_reference,
        short_description: master.short_description,
        long_description: master.long_description,
        cost_cents: null,
        supplier_price_cents: null,
        dim_width_mm: master.dim_width_mm,
        dim_height_mm: master.dim_height_mm,
        dim_depth_mm: master.dim_depth_mm,
        weight_grams: master.weight_grams,
        catalog_product_id: master.id,
        catalog_version_synced: master.version,
        created_by: session.user_id,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, error: error?.message ?? "No se pudo crear el producto" };
    }
    const productId = (created as { id: string }).id;

    await copyAttributes(admin, session.company_id, master.id, productId, categoryId);
    await copyPhotos(admin, session.company_id, master.id, productId);
    await copyDocuments(admin, session.company_id, session.user_id, master.id, productId);

    revalidatePath("/productos");
    revalidatePath(`/productos/${productId}`);
    return { ok: true, id: productId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
