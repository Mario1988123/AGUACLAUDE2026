"use server";
/**
 * Ficha técnica de UN producto: qué secciones del PDF salen (ventajas,
 * consumibles y recambios, dibujo de medidas). Anula lo de la empresa
 * (company_settings.datasheet_opciones) y se guarda en
 * products.datasheet_extra.ficha_secciones, sin tocar el resto del jsonb
 * (lo de la ficha IAGUA). Sin migración: la columna ya existe.
 *
 * Service-role tras comprobar editor + que el producto es de su empresa.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { isProductEditor, PRODUCTS_NOT_EDITOR_ERROR } from "./permissions";
import { fusionarSeccionesProducto, SECCIONES_FICHA, type SeccionFicha } from "./ficha/modelo";

type Resultado = { ok: true } | { ok: false; error: string };

export async function guardarSeccionFichaAction(
  productId: string,
  seccion: SeccionFicha,
  valor: boolean | null,
): Promise<Resultado> {
  try {
    if (!SECCIONES_FICHA.includes(seccion)) throw new Error("Sección desconocida");
    if (valor !== null && typeof valor !== "boolean") throw new Error("Valor no válido");
    const session = await requireSession();
    if (!session.company_id) throw new Error("Sin empresa");
    if (!isProductEditor(session)) throw new Error(PRODUCTS_NOT_EDITOR_ERROR);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: prod, error } = await admin
      .from("products")
      .select("id, datasheet_extra")
      .eq("id", productId)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!prod) throw new Error("Producto no encontrado o no pertenece a tu empresa");
    const extra = fusionarSeccionesProducto((prod as { datasheet_extra: unknown }).datasheet_extra, {
      [seccion]: valor,
    });
    const { error: e2 } = await admin
      .from("products")
      .update({ datasheet_extra: Object.keys(extra).length > 0 ? extra : null })
      .eq("id", productId)
      .eq("company_id", session.company_id);
    if (e2) throw new Error(e2.message);
    revalidatePath(`/productos/${productId}`);
    revalidatePath(`/productos/${productId}/editar`);
    revalidatePath(`/productos/${productId}/ficha`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
