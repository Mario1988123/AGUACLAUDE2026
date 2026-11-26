/**
 * Ayudantes COMPARTIDOS para copiar un producto del catálogo MAESTRO al de una
 * empresa (importar en Fase 3 y aplicar actualización en Fase 4). Módulo PLANO
 * (sin "use server"): reciben el cliente admin (service-role) por parámetro.
 */

import { ensureBucket } from "@/shared/lib/supabase/storage-buckets";
import { hayColumnaOrigen } from "./atributos-origen";

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

/** Resultado de copiar atributos (para registrar lo que ha pasado). */
export interface ResultadoCopiaAtributos {
  anadidos: number;
  actualizados: number;
  omitidos: number;
}

/**
 * Copia los valores de atributos del maestro al producto local, clonando los
 * atributos globales→locales que falten (con su grupo: Físicas, Eléctricas…).
 *
 * - Si `replace`, borra antes los valores actuales del producto.
 * - Si el producto YA tiene valor para ese atributo:
 *     · origen 'maestro' (copiado y sin tocar) → se pone el valor nuevo;
 *     · 'editado', 'propio' o sin marca → se respeta (la capa de la empresa).
 * - El atributo local se busca por el global del que se clonó y, si no, por la
 *   misma clave en la misma categoría (antes, una clave repetida hacía fallar el
 *   alta del atributo en silencio y el valor se perdía).
 */
export async function copyAttributes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  masterId: string,
  productId: string,
  categoryId: string | null,
  replace = false,
): Promise<ResultadoCopiaAtributos> {
  const res: ResultadoCopiaAtributos = { anadidos: 0, actualizados: 0, omitidos: 0 };
  if (replace) {
    const { error } = await admin.from("product_attribute_values").delete().eq("product_id", productId);
    if (error) throw new Error(`No se pudieron quitar las características: ${error.message}`);
  }
  const { data: avRows, error: avErr } = await admin
    .from("catalog_product_attributes")
    .select("attribute_global_key, value_text, value_number, value_boolean, display_order")
    .eq("catalog_product_id", masterId)
    .order("display_order");
  if (avErr) throw new Error(`No se pudieron leer las características del maestro: ${avErr.message}`);
  const av = (avRows ?? []) as Array<{
    attribute_global_key: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    display_order: number;
  }>;
  if (av.length === 0) return res;

  const { data: metas, error: metaErr } = await admin
    .from("product_attributes_global")
    .select("id, key, name_es, data_type, unit, enum_values, grupo, sort_order")
    .in(
      "key",
      av.map((a) => a.attribute_global_key),
    );
  if (metaErr) throw new Error(`No se pudieron leer los atributos globales: ${metaErr.message}`);
  const metaByKey = new Map(
    (
      (metas ?? []) as Array<{
        id: string;
        key: string;
        name_es: string;
        data_type: string;
        unit: string | null;
        enum_values: string[] | null;
        grupo: string | null;
        sort_order: number | null;
      }>
    ).map((m) => [m.key, m]),
  );

  const conOrigen = await hayColumnaOrigen(admin);
  const { data: actuales } = await admin
    .from("product_attribute_values")
    .select(conOrigen ? "id, attribute_id, origen" : "id, attribute_id")
    .eq("product_id", productId);
  const valorActual = new Map(
    ((actuales ?? []) as Array<{ id: string; attribute_id: string; origen?: string | null }>).map(
      (v) => [v.attribute_id, v],
    ),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enCategoria = (q: any) =>
    categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);

  for (const a of av) {
    const meta = metaByKey.get(a.attribute_global_key);
    if (!meta) {
      res.omitidos += 1;
      continue;
    }
    let local: { id: string; grupo: string | null } | null = null;
    {
      const { data } = await enCategoria(
        admin
          .from("product_attributes")
          .select("id, grupo")
          .eq("company_id", companyId)
          .eq("cloned_from_global_id", meta.id),
      )
        .limit(1)
        .maybeSingle();
      local = (data as { id: string; grupo: string | null } | null) ?? null;
    }
    if (!local) {
      const { data } = await enCategoria(
        admin
          .from("product_attributes")
          .select("id, grupo")
          .eq("company_id", companyId)
          .eq("key", meta.key),
      )
        .limit(1)
        .maybeSingle();
      local = (data as { id: string; grupo: string | null } | null) ?? null;
    }
    if (!local) {
      const { data: ins, error: insErr } = await admin
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
          grupo: meta.grupo,
          sort_order: meta.sort_order ?? 0,
          default_visible: true,
        })
        .select("id, grupo")
        .maybeSingle();
      if (insErr) console.error("[copyAttributes] alta de atributo:", meta.key, insErr.message);
      local = (ins as { id: string; grupo: string | null } | null) ?? null;
    } else if (!local.grupo && meta.grupo) {
      // Rellena el grupo vacío (los atributos antiguos no lo traían).
      await admin
        .from("product_attributes")
        .update({ grupo: meta.grupo })
        .eq("id", local.id)
        .is("grupo", null);
    }
    if (!local) {
      res.omitidos += 1;
      continue;
    }

    const valores = {
      value_text: a.value_text,
      value_number: a.value_number,
      value_boolean: a.value_boolean,
    };
    const ya = valorActual.get(local.id);
    if (ya) {
      if (conOrigen && ya.origen === "maestro" && ya.id) {
        const { error } = await admin
          .from("product_attribute_values")
          .update({ ...valores, display_order: a.display_order })
          .eq("id", ya.id);
        if (error) console.error("[copyAttributes] actualizar valor:", meta.key, error.message);
        else res.actualizados += 1;
      } else {
        res.omitidos += 1;
      }
      continue;
    }
    const { error } = await admin.from("product_attribute_values").insert({
      product_id: productId,
      attribute_id: local.id,
      company_id: companyId,
      ...valores,
      is_visible: true,
      is_featured: false,
      display_order: a.display_order,
      ...(conOrigen ? { origen: "maestro" } : {}),
    });
    if (error) {
      console.error("[copyAttributes] alta de valor:", meta.key, error.message);
      res.omitidos += 1;
    } else {
      res.anadidos += 1;
      valorActual.set(local.id, { id: "", attribute_id: local.id, origen: "maestro" });
    }
  }
  return res;
}

const TIPOS_FOTO_LOCAL = new Set([
  "principal",
  "ambiente",
  "medidas",
  "ficha",
  "banner",
  "proyeccion",
  "detalle",
  "despiece",
]);

const MIME_POR_EXT: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
};

/** Ruta en el bucket de la empresa de una foto del maestro. Fija por foto, para
 *  que volver a copiar (actualización, reparación) no la duplique. */
export function rutaFotoCopiada(
  companyId: string,
  productId: string,
  masterPhotoId: string,
  masterPath: string,
): string {
  const ext = masterPath.split(".").pop()?.toLowerCase() || "jpg";
  return `${companyId}/${productId}/m-${masterPhotoId}.${ext}`;
}

/**
 * Copia TODAS las fotos del maestro (principal, ficha, ambiente, medidas,
 * banner, proyecciones…) al bucket público de la empresa + product_images, con
 * su tipo, texto alternativo y medidas. Solo AÑADE: no borra ni cambia las que
 * la empresa ya tenga, y no copia dos veces la misma foto. La principal del
 * maestro solo pasa a principal si el producto aún no tiene una.
 */
export async function copyPhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  masterId: string,
  productId: string,
): Promise<number> {
  const { data: rows, error: fotosErr } = await admin
    .from("catalog_product_photos")
    .select("id, storage_path, is_main, display_order, tipo_foto, alt_text, width_px, height_px, created_at")
    .eq("catalog_product_id", masterId)
    .order("is_main", { ascending: false })
    .order("display_order");
  if (fotosErr) throw new Error(`No se pudieron leer las fotos del maestro: ${fotosErr.message}`);
  const photos = (rows ?? []) as Array<{
    id: string;
    storage_path: string;
    is_main: boolean;
    display_order: number;
    tipo_foto: string | null;
    alt_text: string | null;
    width_px: number | null;
    height_px: number | null;
    created_at: string | null;
  }>;
  if (photos.length === 0) return 0;
  await ensureBucket(admin, IMAGES_BUCKET);

  const [{ data: ya }, { data: prod }] = await Promise.all([
    admin.from("product_images").select("storage_path, is_main").eq("product_id", productId),
    admin.from("products").select("main_image_url, created_at").eq("id", productId).maybeSingle(),
  ]);
  const existentes = (ya ?? []) as Array<{ storage_path: string; is_main: boolean }>;
  const rutas = new Set(existentes.map((e) => e.storage_path));
  // Importaciones antiguas (antes del 26-11) guardaban «<empresa>/<producto>/0.png»:
  // las fotos del maestro que ya existían al importar ya están copiadas así.
  const creadoEn = (prod as { created_at: string | null } | null)?.created_at ?? null;
  const copiaAntigua = existentes.some((e) => /\/\d+\.[a-z0-9]+$/i.test(e.storage_path));
  const yaCopiadaAntes = (f: { created_at: string | null }) =>
    copiaAntigua && !!creadoEn && !!f.created_at && Date.parse(f.created_at) < Date.parse(creadoEn);
  let tienePrincipal = existentes.some((e) => e.is_main);
  let tieneUrlPrincipal = !!(prod as { main_image_url: string | null } | null)?.main_image_url;

  let copiadas = 0;
  for (const ph of photos) {
    const target = rutaFotoCopiada(companyId, productId, ph.id, ph.storage_path);
    if (rutas.has(target) || yaCopiadaAntes(ph)) continue;
    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from(CATALOG_BUCKET)
        .download(ph.storage_path);
      if (dlErr || !blob) {
        console.error("[copyPhotos] descarga:", ph.storage_path, dlErr?.message);
        continue;
      }
      const ext = ph.storage_path.split(".").pop()?.toLowerCase() || "jpg";
      const buf = Buffer.from(await blob.arrayBuffer());
      const contentType = (blob as { type?: string }).type || MIME_POR_EXT[ext] || "image/jpeg";
      const { error: upErr } = await admin.storage
        .from(IMAGES_BUCKET)
        .upload(target, buf, { contentType, upsert: true });
      if (upErr) {
        console.error("[copyPhotos] subida:", target, upErr.message);
        continue;
      }
      const principal = ph.is_main && !tienePrincipal;
      const { error: insErr } = await admin.from("product_images").insert({
        company_id: companyId,
        product_id: productId,
        storage_path: target,
        is_main: principal,
        display_order: ph.display_order,
        tipo_foto: ph.tipo_foto && TIPOS_FOTO_LOCAL.has(ph.tipo_foto) ? ph.tipo_foto : null,
        alt_text: ph.alt_text,
        width_px: ph.width_px,
        height_px: ph.height_px,
      });
      if (insErr) {
        console.error("[copyPhotos] fila de foto:", target, insErr.message);
        continue;
      }
      rutas.add(target);
      copiadas += 1;
      if (principal) {
        tienePrincipal = true;
        if (!tieneUrlPrincipal) {
          const { data: pub } = admin.storage.from(IMAGES_BUCKET).getPublicUrl(target);
          const url = (pub as { publicUrl: string }).publicUrl;
          await admin.from("products").update({ main_image_url: url }).eq("id", productId);
          tieneUrlPrincipal = true;
        }
      }
    } catch (e) {
      // Una foto que falla no bloquea el resto.
      console.error("[copyPhotos]", ph.storage_path, e instanceof Error ? e.message : e);
    }
  }
  return copiadas;
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
