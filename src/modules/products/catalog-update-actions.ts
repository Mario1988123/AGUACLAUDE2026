"use server";
/**
 * FASE 4 — Avisos de actualización del catálogo MAESTRO.
 *
 * Un producto de la empresa enganchado (catalog_product_id) está "desactualizado"
 * cuando la versión del maestro (catalog_products.version) es mayor que la que la
 * empresa copió (products.catalog_version_synced). Entonces se muestra el aviso
 * "⚠ Actualización disponible". La empresa decide:
 *   - Aplicar: re-sincroniza datos + atributos + documentos nuevos del maestro
 *     (NO toca precio, stock, referencia interna ni sus fotos) y pone synced=version.
 *   - Descartar: sube synced=version sin copiar nada (se queda su versión).
 *
 * Lecturas defensivas: si la migración no estuviera aplicada, se degrada a "sin
 * aviso" en vez de romper.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { isProductEditor, PRODUCTS_NOT_EDITOR_ERROR } from "./permissions";
import { copyAttributes, copyDocuments } from "./catalog-copy-helpers";

export interface ProductCatalogStatus {
  linked: boolean;
  hasUpdate: boolean;
  masterName: string | null;
  fromVersion: number | null;
  toVersion: number | null;
}

const NONE: ProductCatalogStatus = {
  linked: false,
  hasUpdate: false,
  masterName: null,
  fromVersion: null,
  toVersion: null,
};

export async function getProductCatalogStatus(
  productId: string,
): Promise<ProductCatalogStatus> {
  try {
    const session = await requireSession();
    if (!session.company_id) return NONE;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: p, error } = await admin
      .from("products")
      .select("catalog_product_id, catalog_version_synced, company_id")
      .eq("id", productId)
      .maybeSingle();
    if (error || !p) return NONE;
    const prod = p as {
      catalog_product_id: string | null;
      catalog_version_synced: number | null;
      company_id: string;
    };
    if (prod.company_id !== session.company_id || !prod.catalog_product_id) return NONE;

    const { data: master } = await admin
      .from("catalog_products")
      .select("name, version")
      .eq("id", prod.catalog_product_id)
      .maybeSingle();
    const m = master as { name: string; version: number } | null;
    const fromVersion = prod.catalog_version_synced ?? 0;
    const toVersion = m?.version ?? fromVersion;
    return {
      linked: true,
      hasUpdate: toVersion > fromVersion,
      masterName: m?.name ?? null,
      fromVersion,
      toVersion,
    };
  } catch {
    return NONE;
  }
}

/** IDs de productos de la empresa con actualización disponible (para badges en
 *  el listado). Defensiva: [] si algo falla. */
export async function listOutdatedProductIds(): Promise<string[]> {
  try {
    const session = await requireSession();
    if (!session.company_id) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prods, error } = await admin
      .from("products")
      .select("id, catalog_product_id, catalog_version_synced")
      .eq("company_id", session.company_id)
      .not("catalog_product_id", "is", null)
      .is("deleted_at", null);
    if (error || !prods) return [];
    const rows = prods as Array<{
      id: string;
      catalog_product_id: string;
      catalog_version_synced: number | null;
    }>;
    if (rows.length === 0) return [];
    const masterIds = Array.from(new Set(rows.map((r) => r.catalog_product_id)));
    const { data: masters } = await admin
      .from("catalog_products")
      .select("id, version")
      .in("id", masterIds);
    const verById = new Map(
      ((masters ?? []) as Array<{ id: string; version: number }>).map((m) => [m.id, m.version]),
    );
    return rows
      .filter((r) => (verById.get(r.catalog_product_id) ?? 0) > (r.catalog_version_synced ?? 0))
      .map((r) => r.id);
  } catch {
    return [];
  }
}

export async function applyCatalogUpdateSafeAction(
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session)) return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };
    const companyId = session.company_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: p } = await admin
      .from("products")
      .select("catalog_product_id, company_id, category_id")
      .eq("id", productId)
      .maybeSingle();
    const prod = p as {
      catalog_product_id: string | null;
      company_id: string;
      category_id: string | null;
    } | null;
    if (!prod || prod.company_id !== companyId) return { ok: false, error: "Producto no encontrado" };
    if (!prod.catalog_product_id) return { ok: false, error: "Este producto no viene del catálogo" };

    const { data: master } = await admin
      .from("catalog_products")
      .select(
        "name, kind, short_description, long_description, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, version",
      )
      .eq("id", prod.catalog_product_id)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = master as any;
    if (!ms) return { ok: false, error: "El producto maestro ya no existe" };

    // Re-sincronizar datos (NO toca precio/stock/ref interna/fotos).
    await admin
      .from("products")
      .update({
        name: ms.name,
        kind: ms.kind,
        short_description: ms.short_description,
        long_description: ms.long_description,
        dim_width_mm: ms.dim_width_mm,
        dim_height_mm: ms.dim_height_mm,
        dim_depth_mm: ms.dim_depth_mm,
        weight_grams: ms.weight_grams,
        catalog_version_synced: ms.version,
      })
      .eq("id", productId);

    // Atributos: reemplazo total con los del maestro.
    await copyAttributes(admin, companyId, prod.catalog_product_id, productId, prod.category_id, true);

    // Documentos: añadir SOLO los del maestro que aún no tenga (por título).
    const { data: existingDocs } = await admin
      .from("product_documents")
      .select("title")
      .eq("product_id", productId);
    const skip = new Set(
      ((existingDocs ?? []) as Array<{ title: string }>).map((d) => d.title),
    );
    await copyDocuments(admin, companyId, session.user_id, prod.catalog_product_id, productId, skip);

    revalidatePath("/productos");
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function dismissCatalogUpdateSafeAction(
  productId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session)) return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: p } = await admin
      .from("products")
      .select("catalog_product_id, company_id")
      .eq("id", productId)
      .maybeSingle();
    const prod = p as { catalog_product_id: string | null; company_id: string } | null;
    if (!prod || prod.company_id !== session.company_id || !prod.catalog_product_id) {
      return { ok: false, error: "Producto no encontrado" };
    }
    const { data: master } = await admin
      .from("catalog_products")
      .select("version")
      .eq("id", prod.catalog_product_id)
      .maybeSingle();
    const version = (master as { version: number } | null)?.version ?? null;
    if (version == null) return { ok: false, error: "El producto maestro ya no existe" };
    await admin
      .from("products")
      .update({ catalog_version_synced: version })
      .eq("id", productId);
    revalidatePath(`/productos/${productId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
