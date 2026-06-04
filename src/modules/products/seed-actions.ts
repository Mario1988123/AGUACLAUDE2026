"use server";
/**
 * Server actions para importar el seed estándar del sector agua a la empresa:
 *   - Categorías globales → product_categories de la empresa.
 *   - Líneas de servicio estándar (hora trabajo, desplazamiento, mtos planos).
 *
 * Ambas llaman a las funciones SQL definidas en
 * 20260604101100_seed_helpers.sql. Las funciones SQL ya validan permisos
 * (company_admin de la empresa o superadmin), pero replicamos el guard aquí
 * para devolver mensajes amigables al cliente.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isProductEditor,
  PRODUCTS_NOT_EDITOR_ERROR,
} from "./permissions";

export type SeedImportResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Clona el catálogo global de categorías del sector agua a la empresa.
 * Si ya existen categorías con el mismo nombre, las salta. Devuelve cuántas
 * se insertaron y cuántas se saltaron.
 */
export async function importStandardWaterCategoriesAction(): Promise<SeedImportResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin.rpc("import_global_water_categories", {
      p_company_id: session.company_id,
    });

    if (error) return { ok: false, error: error.message };

    const row = Array.isArray(data) ? data[0] : data;
    const inserted = Number(row?.inserted_count ?? 0);
    const skipped = Number(row?.skipped_count ?? 0);

    revalidatePath("/productos");
    revalidatePath("/configuracion/productos");
    return { ok: true, inserted, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Crea las 4 líneas de servicio estándar (hora trabajo, desplazamiento por km,
 * mantenimiento de ósmosis, mantenimiento de descalcificador) bajo la
 * categoría "Servicio" de la empresa. Requiere haber importado primero las
 * categorías estándar.
 */
export async function importStandardServiceLinesAction(): Promise<SeedImportResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session))
      return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin.rpc("import_standard_service_lines", {
      p_company_id: session.company_id,
    });

    if (error) return { ok: false, error: error.message };

    const row = Array.isArray(data) ? data[0] : data;
    const inserted = Number(row?.inserted_count ?? 0);
    const skipped = Number(row?.skipped_count ?? 0);

    revalidatePath("/productos");
    revalidatePath("/configuracion/productos");
    return { ok: true, inserted, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
