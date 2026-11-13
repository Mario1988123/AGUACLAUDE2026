"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { isProductEditor } from "@/modules/products/permissions";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { modeloEquipoDisponible } from "./datos";
import { esTipoEquipo, type TipoEquipo } from "./logica";

/**
 * Catálogo: tipo de equipo (categoría y producto), variantes de una gama y
 * rasgos para identificar. Solo editor de productos (admin). Regla 0 del
 * plan: no se renombra ni se mueve de categoría nada; solo se añaden datos.
 */

type R = { ok: true; id?: string } | { ok: false; error: string };

const SIN_MIGRACION = "Falta aplicar la migración del modelo de equipo (20261113090000).";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function contexto(): Promise<
  { ok: true; companyId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (!isProductEditor(session)) return { ok: false, error: "Solo el administrador" };
  if (!(await modeloEquipoDisponible())) return { ok: false, error: SIN_MIGRACION };
  return { ok: true, companyId: session.company_id, userId: session.user_id };
}

/** Traduce los errores del trigger de un nivel a algo legible. */
function mensajeBd(msg: string): string {
  if (/variante de sí mismo|ya es una variante|tiene variantes|otra empresa|no existe/i.test(msg)) {
    return msg.replace(/^.*?ERROR:\s*/i, "");
  }
  return msg;
}

export async function guardarModeloProductoAction(
  productId: string,
  input: { tipo_equipo: TipoEquipo | null; gama_id: string | null; rasgos_identificacion: string | null },
): Promise<R> {
  try {
    const c = await contexto();
    if (!c.ok) return c;
    if (!UUID.test(productId)) return { ok: false, error: "Producto no válido" };
    if (input.tipo_equipo !== null && !esTipoEquipo(input.tipo_equipo)) {
      return { ok: false, error: "Tipo no válido" };
    }
    if (input.gama_id !== null && !UUID.test(input.gama_id)) {
      return { ok: false, error: "Gama no válida" };
    }
    if (input.gama_id === productId) {
      return { ok: false, error: "Un producto no puede ser variante de sí mismo" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    if (input.gama_id) {
      const { data: g } = await admin
        .from("products")
        .select("id, gama_id")
        .eq("id", input.gama_id)
        .eq("company_id", c.companyId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!g) return { ok: false, error: "La gama no existe" };
      if ((g as { gama_id: string | null }).gama_id) {
        return { ok: false, error: "La gama elegida ya es una variante: solo hay un nivel" };
      }
      const { count } = await admin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("company_id", c.companyId)
        .eq("gama_id", productId);
      if ((count ?? 0) > 0) {
        return { ok: false, error: "Este producto tiene variantes: no puede ser variante de otro" };
      }
    }
    const { error } = await admin
      .from("products")
      .update({
        tipo_equipo: input.tipo_equipo,
        gama_id: input.gama_id,
        rasgos_identificacion: input.rasgos_identificacion?.trim() || null,
      })
      .eq("id", productId)
      .eq("company_id", c.companyId);
    if (error) return { ok: false, error: mensajeBd(error.message) };
    revalidatePath(`/productos/${productId}`);
    if (input.gama_id) revalidatePath(`/productos/${input.gama_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Alta de una variante nueva bajo una gama: producto hijo con el nombre que
 * escribe Mario, misma categoría y tipo de producto. Sin precios (se vende la
 * gama) ni filtros (los hereda).
 */
export async function crearVarianteAction(
  gamaId: string,
  input: { name: string; rasgos_identificacion?: string | null },
): Promise<R> {
  try {
    const c = await contexto();
    if (!c.ok) return c;
    const name = (input.name ?? "").trim();
    if (name.length < 1) return { ok: false, error: "Escribe el nombre de la variante" };
    if (!UUID.test(gamaId)) return { ok: false, error: "Gama no válida" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: g } = await admin
      .from("products")
      .select("id, kind, category_id, gama_id, stock_managed")
      .eq("id", gamaId)
      .eq("company_id", c.companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!g) return { ok: false, error: "La gama no existe" };
    const gama = g as {
      kind: string;
      category_id: string | null;
      gama_id: string | null;
      stock_managed: boolean;
    };
    if (gama.gama_id) return { ok: false, error: "Una variante no puede tener variantes" };
    const { data: dup } = await admin
      .from("products")
      .select("id")
      .eq("company_id", c.companyId)
      .eq("gama_id", gamaId)
      .ilike("name", name.replace(/[%_]/g, ""))
      .is("deleted_at", null)
      .limit(1);
    if ((dup ?? []).length > 0) return { ok: false, error: "Ya existe una variante con ese nombre" };
    const { data: ins, error } = await admin
      .from("products")
      .insert({
        company_id: c.companyId,
        kind: gama.kind,
        name,
        category_id: gama.category_id,
        stock_managed: gama.stock_managed,
        is_active: true,
        gama_id: gamaId,
        rasgos_identificacion: input.rasgos_identificacion?.trim() || null,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: mensajeBd(error.message) };
    revalidatePath(`/productos/${gamaId}`);
    revalidatePath("/productos");
    return { ok: true, id: (ins as { id: string }).id };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function guardarTipoCategoriaAction(
  categoryId: string,
  tipo: TipoEquipo | null,
): Promise<R> {
  try {
    const c = await contexto();
    if (!c.ok) return c;
    if (!UUID.test(categoryId)) return { ok: false, error: "Categoría no válida" };
    if (tipo !== null && !esTipoEquipo(tipo)) return { ok: false, error: "Tipo no válido" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("product_categories")
      .update({ tipo_equipo: tipo })
      .eq("id", categoryId)
      .eq("company_id", c.companyId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/productos");
    revalidatePath("/configuracion/productos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
