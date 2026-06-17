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
import {
  resolveLocalCategory,
  copyAttributes,
  copyPhotos,
  copyDocuments,
} from "./catalog-copy-helpers";

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
