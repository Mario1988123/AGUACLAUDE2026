"use server";
/**
 * Capa de la EMPRESA sobre las características de un producto (Editar →
 * Características). Todo sobre la COPIA de la empresa (product_attribute_values
 * y product_attributes): el catálogo maestro no se toca nunca.
 *
 *   - editar el valor (un heredado pasa a origen 'editado' y ninguna
 *     actualización del maestro lo vuelve a pisar);
 *   - ocultar / enseñar (is_visible) y destacar para el PDF (is_featured, máx. 5);
 *   - subir y bajar dentro de su grupo (display_order);
 *   - añadir una propia (origen 'propio');
 *   - quitar SOLO las propias: las heredadas se ocultan, porque si se borrasen
 *     la siguiente actualización del maestro las volvería a traer.
 *
 * Service-role tras comprobar editor + que el producto es de su empresa.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { isProductEditor, PRODUCTS_NOT_EDITOR_ERROR } from "./permissions";
import { hayColumnaOrigen } from "./atributos-origen";
import { leerCaracteristicasEmpresa } from "./productos-lectura";
import { GRUPOS_ATRIBUTO, reordenarEnGrupo, valorAColumnas } from "./productos-vista";

type Resultado = { ok: true } | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function contexto(productId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!isProductEditor(session)) throw new Error(PRODUCTS_NOT_EDITOR_ERROR);
  const admin: Admin = createAdminClient();
  const { data: prod, error } = await admin
    .from("products")
    .select("id, category_id")
    .eq("id", productId)
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prod) throw new Error("Producto no encontrado o no pertenece a tu empresa");
  return {
    admin,
    companyId: session.company_id as string,
    categoryId: (prod as { category_id: string | null }).category_id,
  };
}

async function valorDe(admin: Admin, companyId: string, productId: string, valorId: string) {
  const conOrigen = await hayColumnaOrigen(admin);
  const { data, error } = await admin
    .from("product_attribute_values")
    .select(
      "id, attribute_id, is_featured" + (conOrigen ? ", origen" : ""),
    )
    .eq("id", valorId)
    .eq("product_id", productId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Característica no encontrada");
  return {
    conOrigen,
    valor: data as { id: string; attribute_id: string; is_featured: boolean; origen?: string | null },
  };
}

function revalidar(productId: string) {
  revalidatePath(`/productos/${productId}`);
  revalidatePath(`/productos/${productId}/editar`);
}

export async function editarValorCaracteristicaAction(
  productId: string,
  valorId: string,
  entrada: string | boolean | null,
): Promise<Resultado> {
  try {
    const { admin, companyId } = await contexto(productId);
    const { conOrigen, valor } = await valorDe(admin, companyId, productId, valorId);
    const { data: attr } = await admin
      .from("product_attributes")
      .select("data_type")
      .eq("id", valor.attribute_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const cols = valorAColumnas((attr as { data_type: string } | null)?.data_type ?? "text", entrada);
    const origen =
      conOrigen && (valor.origen === "maestro" || valor.origen == null) ? { origen: "editado" } : {};
    // Un valor antiguo (sin marca) de un atributo propio no se marca como «editado».
    if (conOrigen && valor.origen == null) {
      const { data: a2 } = await admin
        .from("product_attributes")
        .select("cloned_from_global_id")
        .eq("id", valor.attribute_id)
        .maybeSingle();
      if (!(a2 as { cloned_from_global_id: string | null } | null)?.cloned_from_global_id) {
        delete (origen as { origen?: string }).origen;
      }
    }
    const { error } = await admin
      .from("product_attribute_values")
      .update({ ...cols, ...origen })
      .eq("id", valorId)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function cambiarVisibleCaracteristicaAction(
  productId: string,
  valorId: string,
  visible: boolean,
): Promise<Resultado> {
  try {
    const { admin, companyId } = await contexto(productId);
    await valorDe(admin, companyId, productId, valorId);
    const { error } = await admin
      .from("product_attribute_values")
      .update({ is_visible: visible })
      .eq("id", valorId)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function cambiarDestacadoCaracteristicaAction(
  productId: string,
  valorId: string,
  destacado: boolean,
): Promise<Resultado> {
  try {
    const { admin, companyId } = await contexto(productId);
    await valorDe(admin, companyId, productId, valorId);
    if (destacado) {
      const { count } = await admin
        .from("product_attribute_values")
        .select("id", { count: "exact", head: true })
        .eq("product_id", productId)
        .eq("company_id", companyId)
        .eq("is_featured", true)
        .neq("id", valorId);
      if ((count ?? 0) >= 5) throw new Error("Máximo 5 características destacadas por producto");
    }
    const { error } = await admin
      .from("product_attribute_values")
      .update({ is_featured: destacado })
      .eq("id", valorId)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function moverCaracteristicaAction(
  productId: string,
  valorId: string,
  direccion: "subir" | "bajar",
): Promise<Resultado> {
  try {
    const { admin, companyId } = await contexto(productId);
    const { caracteristicas } = await leerCaracteristicasEmpresa(productId, admin);
    const orden = reordenarEnGrupo(
      caracteristicas.map((c) => ({ valorId: c.valorId, grupo: c.grupo, orden: c.orden })),
      valorId,
      direccion,
    );
    if (!orden) return { ok: true };
    const actual = new Map(caracteristicas.map((c) => [c.valorId, c.orden]));
    for (let i = 0; i < orden.length; i += 1) {
      const id = orden[i]!;
      if (actual.get(id) === i) continue;
      const { error } = await admin
        .from("product_attribute_values")
        .update({ display_order: i })
        .eq("id", id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
    }
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

function claveDe(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return base.length >= 2 ? `propio_${base}` : `propio_${Date.now()}`;
}

export interface NuevaCaracteristica {
  /** Atributo de la empresa ya existente (si no, se crea uno con `nombre`). */
  atributoId?: string | null;
  nombre?: string;
  grupo?: string | null;
  tipo?: "text" | "number" | "boolean";
  unidad?: string | null;
  valor: string | boolean;
}

export async function anadirCaracteristicaAction(
  productId: string,
  input: NuevaCaracteristica,
): Promise<Resultado> {
  try {
    const { admin, companyId, categoryId } = await contexto(productId);
    const grupo =
      input.grupo && (GRUPOS_ATRIBUTO as readonly string[]).includes(input.grupo) ? input.grupo : null;

    let atributoId: string | null = null;
    let dataType = "text";
    if (input.atributoId) {
      const { data, error } = await admin
        .from("product_attributes")
        .select("id, data_type")
        .eq("id", input.atributoId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Esa característica no es de tu empresa");
      atributoId = (data as { id: string }).id;
      dataType = (data as { data_type: string }).data_type;
    } else {
      const nombre = (input.nombre ?? "").trim();
      if (nombre.length < 2) throw new Error("Escribe el nombre de la característica");
      dataType = input.tipo === "number" || input.tipo === "boolean" ? input.tipo : "text";
      const key = claveDe(nombre);
      // ¿Ya hay una con esa clave en la categoría? Se reutiliza.
      let q = admin.from("product_attributes").select("id, data_type").eq("company_id", companyId).eq("key", key);
      q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);
      const { data: ya } = await q.limit(1).maybeSingle();
      if (ya) {
        atributoId = (ya as { id: string }).id;
        dataType = (ya as { data_type: string }).data_type;
      } else {
        const { data: ins, error } = await admin
          .from("product_attributes")
          .insert({
            company_id: companyId,
            category_id: categoryId,
            key,
            name: nombre,
            data_type: dataType,
            unit: input.unidad?.trim() || null,
            grupo,
            default_visible: true,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        atributoId = (ins as { id: string }).id;
      }
    }

    const { data: repetido } = await admin
      .from("product_attribute_values")
      .select("id")
      .eq("product_id", productId)
      .eq("attribute_id", atributoId)
      .maybeSingle();
    if (repetido) throw new Error("Este producto ya tiene esa característica: edítala en la lista");

    const { data: ultimo } = await admin
      .from("product_attribute_values")
      .select("display_order")
      .eq("product_id", productId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const conOrigen = await hayColumnaOrigen(admin);
    const { error } = await admin.from("product_attribute_values").insert({
      product_id: productId,
      attribute_id: atributoId,
      company_id: companyId,
      ...valorAColumnas(dataType, input.valor),
      is_visible: true,
      is_featured: false,
      display_order: ((ultimo as { display_order: number } | null)?.display_order ?? -1) + 1,
      ...(conOrigen ? { origen: "propio" } : {}),
    });
    if (error) throw new Error(error.message);
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function quitarCaracteristicaAction(
  productId: string,
  valorId: string,
): Promise<Resultado> {
  try {
    const { admin, companyId } = await contexto(productId);
    const { valor } = await valorDe(admin, companyId, productId, valorId);
    const { data: attr } = await admin
      .from("product_attributes")
      .select("cloned_from_global_id")
      .eq("id", valor.attribute_id)
      .maybeSingle();
    const heredado =
      valor.origen === "maestro" ||
      valor.origen === "editado" ||
      (!valor.origen && !!(attr as { cloned_from_global_id: string | null } | null)?.cloned_from_global_id);
    if (heredado) {
      throw new Error("Las características del catálogo no se borran: apaga «Visible» para ocultarla");
    }
    const { error } = await admin
      .from("product_attribute_values")
      .delete()
      .eq("id", valorId)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidar(productId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
