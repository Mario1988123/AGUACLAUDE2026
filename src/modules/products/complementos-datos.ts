import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { cargarCatalogoModelo } from "@/modules/equipos-modelo/datos";
import { tipoEfectivoProducto } from "@/modules/equipos-modelo/logica";
import type { InfoComplemento } from "@/shared/lib/packs/complemento";

/**
 * Datos de compatibilidad de COMPLEMENTOS (Horeca ↔ ósmosis/UF) por producto.
 * Admin + company_id (el admin salta RLS). TOLERANTE: si la migración
 * 20261127100000_pack_complemento.sql no está aplicada, no hay
 * complementa_keys ni relacion y solo queda la regla por tipo de equipo
 * (que tampoco tendrá 'horeca' hasta entonces): no se ofrece nada.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * ¿Está aplicada la migración 20261127100000? Se mira que existan sus columnas
 * (relacion, complementa_keys, pack_role). Sin ella no se acepta ningún
 * complemento: guardaría un precio 0 sin rol.
 */
export async function complementoDisponible(): Promise<boolean> {
  const admin = createAdminClient() as Admin;
  const [a, b, c] = await Promise.all([
    admin.from("product_extra_targets").select("relacion").limit(1),
    admin.from("product_categories_global").select("complementa_keys").limit(1),
    admin.from("proposal_items").select("pack_role").limit(1),
  ]);
  return !a.error && !b.error && !c.error;
}

export async function cargarInfoComplementos(
  companyId: string,
): Promise<Map<string, InfoComplemento>> {
  const admin = createAdminClient() as Admin;
  const salida = new Map<string, InfoComplemento>();
  const cat = await cargarCatalogoModelo(companyId);

  // Categorías de la empresa (cadena de padres) y su categoría global.
  const { data: catsRaw } = await admin
    .from("product_categories")
    .select("id, parent_id, cloned_from_global_id")
    .eq("company_id", companyId);
  const cats = new Map(
    ((catsRaw ?? []) as Array<{ id: string; parent_id: string | null; cloned_from_global_id: string | null }>).map(
      (c) => [c.id, c],
    ),
  );

  // Globales: clave, padre y complementa_keys (columna nueva → defensivo).
  type G = { id: string; key: string; parent_key: string | null; complementa_keys?: string[] | null };
  let globRes = await admin
    .from("product_categories_global")
    .select("id, key, parent_key, complementa_keys");
  if (globRes.error) {
    globRes = await admin.from("product_categories_global").select("id, key, parent_key");
  }
  const globales = (globRes.data ?? []) as G[];
  const globalPorId = new Map(globales.map((g) => [g.id, g]));
  const globalPorClave = new Map(globales.map((g) => [g.key, g]));

  // Reglas por producto con relacion = 'complemento' (columna nueva → defensivo).
  const reglas = new Map<string, { productos: string[]; categorias: string[] }>();
  {
    const { data, error } = await admin
      .from("product_extra_targets")
      .select("extra_product_id, target_category_id, target_equipment_product_id")
      .eq("company_id", companyId)
      .eq("relacion", "complemento");
    if (!error) {
      for (const r of (data ?? []) as Array<{
        extra_product_id: string;
        target_category_id: string | null;
        target_equipment_product_id: string | null;
      }>) {
        const e = reglas.get(r.extra_product_id) ?? { productos: [], categorias: [] };
        if (r.target_equipment_product_id) e.productos.push(r.target_equipment_product_id);
        if (r.target_category_id) e.categorias.push(r.target_category_id);
        reglas.set(r.extra_product_id, e);
      }
    }
  }

  const clavesDeCategoria = (categoryId: string | null): { claves: string[]; complementa: string[] } => {
    const claves: string[] = [];
    const complementa: string[] = [];
    const meterGlobal = (g: G | undefined) => {
      for (let n = 0; g && n < 10; n++) {
        if (claves.includes(g.key)) break;
        claves.push(g.key);
        for (const k of g.complementa_keys ?? []) if (!complementa.includes(k)) complementa.push(k);
        g = g.parent_key ? globalPorClave.get(g.parent_key) : undefined;
      }
    };
    let c = categoryId ? cats.get(categoryId) : undefined;
    for (let n = 0; c && n < 10; n++) {
      if (c.cloned_from_global_id) meterGlobal(globalPorId.get(c.cloned_from_global_id));
      c = c.parent_id ? cats.get(c.parent_id) : undefined;
    }
    return { claves, complementa };
  };

  const porId = new Map(cat.productos.map((p) => [p.id, p]));
  for (const p of cat.productos) {
    // Una variante sin categoría propia usa la de su gama.
    const categoryId = p.category_id ?? (p.gama_id ? porId.get(p.gama_id)?.category_id ?? null : null);
    const { claves, complementa } = clavesDeCategoria(categoryId);
    const r = reglas.get(p.id);
    salida.set(p.id, {
      id: p.id,
      category_id: categoryId,
      tipo: tipoEfectivoProducto(p.id, cat),
      claves,
      complementa_claves: complementa,
      complemento_de_productos: r?.productos ?? [],
      complemento_de_categorias: r?.categorias ?? [],
    });
  }
  return salida;
}
