"use server";
/**
 * Server actions del módulo Productos para gestión de tags:
 *   - Catálogo opcional por empresa (color, descripción, orden).
 *   - Asignación de tags a un producto (`products.tags text[]`).
 *
 * Reglas:
 *   - Lectura: cualquier usuario autenticado de la empresa.
 *   - Escritura del catálogo y de los tags por producto: SOLO admin (regla
 *     feedback_productos_permisos).
 *   - Si un producto recibe un tag que no está en el catálogo, se acepta
 *     tal cual (la tabla `products.tags` admite texto libre).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export interface ProductTagCatalogItem {
  id: string;
  name: string;
  color_hex: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

export type TagActionResult = { ok: true } | { ok: false; error: string };

/**
 * Lista los tags del catálogo de la empresa (activos), ordenados.
 * Defensivo: si la migración 20260604100100 no está aplicada, devuelve [].
 */
export async function listTagsCatalog(): Promise<ProductTagCatalogItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("product_tags_catalog")
    .select("id, name, color_hex, description, display_order, is_active")
    .eq("is_active", true)
    .order("display_order")
    .order("name");
  if (error) {
    // Si la tabla no existe (migración no aplicada), no rompemos la UI.
    if (
      /relation .* does not exist|schema cache/i.test(error.message ?? "") ||
      (error as { code?: string }).code === "42P01"
    ) {
      return [];
    }
    throw error;
  }
  return (data ?? []) as ProductTagCatalogItem[];
}

/**
 * Crea un nuevo tag en el catálogo. Solo admin.
 */
export async function createTagCatalogAction(input: {
  name: string;
  color_hex?: string;
  description?: string | null;
  display_order?: number;
}): Promise<TagActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const name = input.name.trim();
    if (!name) return { ok: false, error: "Nombre obligatorio" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("product_tags_catalog").insert({
      company_id: session.company_id,
      name,
      color_hex: input.color_hex ?? "#4880FF",
      description: input.description ?? null,
      display_order: input.display_order ?? 0,
      created_by: session.user_id,
    });
    if (error) {
      // Tag duplicado: violación de la unique (company_id, name).
      if ((error as { code?: string }).code === "23505") {
        return { ok: false, error: "Ya existe un tag con ese nombre." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Actualiza un tag del catálogo. Solo admin.
 */
export async function updateTagCatalogAction(
  tagId: string,
  input: {
    name?: string;
    color_hex?: string;
    description?: string | null;
    display_order?: number;
    is_active?: boolean;
  },
): Promise<TagActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) return { ok: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_tags_catalog")
      .update(payload)
      .eq("id", tagId)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Reemplaza la lista de tags de un producto. Solo admin.
 *
 * Tags duplicados se eliminan; espacios al inicio/fin se recortan; tags
 * vacíos se descartan. La tabla `products.tags` admite texto libre, así
 * que un tag no tiene por qué estar en el catálogo.
 */
export async function setProductTagsAction(
  productId: string,
  tags: string[],
): Promise<TagActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    const cleaned = Array.from(
      new Set(
        tags
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && t.length <= 60),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("products")
      .update({ tags: cleaned })
      .eq("id", productId)
      .eq("company_id", session.company_id);

    if (error) {
      // Defensivo: si la columna tags todavía no está aplicada, no rompemos.
      if (
        /column .*tags.* does not exist|schema cache/i.test(error.message ?? "") ||
        (error as { code?: string }).code === "42703"
      ) {
        return {
          ok: false,
          error:
            "La base de datos no tiene aún la columna de tags. Aplica las migraciones de Fase 1.",
        };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath(`/productos/${productId}`);
    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
