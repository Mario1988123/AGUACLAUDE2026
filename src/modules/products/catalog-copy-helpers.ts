/**
 * Ayudantes COMPARTIDOS para copiar un producto del catálogo MAESTRO al de una
 * empresa (importar en Fase 3 y aplicar actualización en Fase 4). Módulo PLANO
 * (sin "use server"): reciben el cliente admin (service-role) por parámetro.
 */

import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";

export const CATALOG_BUCKET = "catalog-global";
export const IMAGES_BUCKET = "product-images";
export const DOCS_BUCKET = "product-documents";

/** Localiza (o clona) la categoría LOCAL equivalente a una categoría global. */
export async function resolveLocalCategory(
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

  const { data: byClone } = await admin
    .from("product_categories")
    .select("id")
    .eq("company_id", companyId)
    .eq("cloned_from_global_id", g.id)
    .maybeSingle();
  if (byClone) return (byClone as { id: string }).id;

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

/** Copia los valores de atributos del maestro al producto local (clonando los
 *  atributos globales→locales que falten). Si `replace`, borra antes los valores
 *  actuales del producto (usado al aplicar una actualización). */
export async function copyAttributes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  masterId: string,
  productId: string,
  categoryId: string | null,
  replace = false,
): Promise<void> {
  if (replace) {
    await admin.from("product_attribute_values").delete().eq("product_id", productId);
  }
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

/** Copia las fotos del maestro al bucket de la empresa + product_images. */
export async function copyPhotos(
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
      /* foto que falla no bloquea */
    }
  }
}

/** Copia documentos del maestro al bucket de la empresa + product_documents.
 *  Si `skipTitles` trae títulos ya presentes, no los vuelve a copiar (append). */
export async function copyDocuments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  userId: string,
  masterId: string,
  productId: string,
  skipTitles?: Set<string>,
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
    if (skipTitles && skipTitles.has(d.title)) continue;
    try {
      const { data: blob } = await admin.storage.from(CATALOG_BUCKET).download(d.storage_path);
      if (!blob) continue;
      const name = d.storage_path.split("/").pop() || "doc";
      const target = `${companyId}/${productId}/${Date.now()}-${name}`;
      const buf = Buffer.from(await blob.arrayBuffer());
      const contentType =
        d.mime_type || (blob as { type?: string }).type || "application/octet-stream";
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
      /* doc que falla no bloquea */
    }
  }
}
