"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { isProductEditor, PRODUCTS_NOT_EDITOR_ERROR } from "./permissions";
import { conMarcaPrueba } from "@/modules/free-trials/productos-prueba";

/**
 * Interruptor «Disponible en prueba gratuita» de la ficha del producto
 * (Mario 2026-11-26). Pone o quita el rol `free_trial_role` en
 * `products.roles` sin tocar los demás papeles. Solo el admin.
 */
export async function cambiarDisponiblePruebaSafeAction(
  productId: string,
  disponible: boolean,
): Promise<{ ok: true; disponible: boolean } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isProductEditor(session)) return { ok: false, error: PRODUCTS_NOT_EDITOR_ERROR };
    const id = z.string().uuid().parse(productId);

    // Admin client + company_id: se lee y escribe solo la fila de la empresa.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prod, error: readErr } = await admin
      .from("products")
      .select("id, roles")
      .eq("id", id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!prod) return { ok: false, error: "Producto no encontrado" };

    const roles = conMarcaPrueba((prod as { roles: string[] | null }).roles, disponible);
    const { data: upd, error } = await admin
      .from("products")
      .update({ roles })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .select("id");
    if (error) throw error;
    if (!upd?.length) return { ok: false, error: "No se pudo guardar el cambio" };

    revalidatePath(`/productos/${id}`);
    return { ok: true, disponible };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
