import "server-only";
/**
 * Catálogo maestro — LECTURAS de categorías y atributos globales para las
 * pestañas «Categorías» y «Atributos» del superadmin.
 *
 * Admin client tras comprobar superadmin (como catalogo-lectura.ts). Los
 * recuentos de productos salen de un `(count)` embebido por relación (una
 * sola consulta, sin traer filas de producto: PostgREST corta en 1.000). Las
 * filas de enlace atributo ↔ categoría se leen por tramos con fetchAllRows.
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function asegurarSuperadmin(): Promise<void> {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
}

export interface CategoriaTaxonomia {
  id: string;
  key: string;
  parent_key: string | null;
  name_es: string;
  description_es: string | null;
  default_kind: string;
  sort_order: number;
  is_active: boolean;
  /** Productos del maestro con esta categoría (sin contar las hijas). */
  productos: number;
  /** Atributos enlazados directamente a esta categoría. */
  atributos: number;
}

export interface AtributoTaxonomia {
  id: string;
  key: string;
  name_es: string;
  description_es: string | null;
  data_type: string;
  unit: string | null;
  enum_values: string[] | null;
  grupo: string | null;
  sort_order: number;
  /** Productos del maestro que tienen valor para este atributo. */
  productos: number;
  /** Claves de las categorías enlazadas. */
  categorias: string[];
}

export interface Taxonomia {
  categorias: CategoriaTaxonomia[];
  atributos: AtributoTaxonomia[];
  error: string | null;
}

const contar = (v?: Array<{ count: number }>) => v?.[0]?.count ?? 0;

/** Categorías, atributos, recuentos y enlaces. Lo usan las dos pestañas. */
export async function leerTaxonomia(): Promise<Taxonomia> {
  await asegurarSuperadmin();
  const admin: Admin = createAdminClient();

  const [catsRes, attrsRes, enlaces] = await Promise.all([
    admin
      .from("product_categories_global")
      .select(
        "id, key, parent_key, name_es, description_es, default_kind, sort_order, is_active, n_productos:catalog_products(count)",
      )
      .order("sort_order")
      .order("name_es"),
    fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("product_attributes_global")
          .select(
            "id, key, name_es, description_es, data_type, unit, enum_values, grupo, sort_order, n_productos:catalog_product_attributes(count)",
          )
          .order("sort_order")
          .order("name_es")
          .order("key")
          .range(from, to),
      { label: "catalogo-taxonomia:atributos" },
    )
      // fetchAllRows no lanza: deja el fallo en el log y devuelve lo leído.
      .then((data) => ({ data, error: null as { message?: string } | null })),
    fetchAllRows<{ attribute_key: string; category_key: string }>(
      (from, to) =>
        admin
          .from("product_attributes_global_categories")
          .select("attribute_key, category_key")
          .order("attribute_key")
          .order("category_key")
          .range(from, to),
      { label: "catalogo-taxonomia:enlaces" },
    ),
  ]);

  const errores = [catsRes.error, attrsRes.error]
    .map((e: { message?: string } | null) => e?.message)
    .filter(Boolean);
  if (errores.length > 0) console.error("[catalogo-taxonomia]", errores.join(" · "));

  const catsPorAtributo = new Map<string, string[]>();
  const attrsPorCategoria = new Map<string, number>();
  for (const e of enlaces) {
    const lista = catsPorAtributo.get(e.attribute_key) ?? [];
    lista.push(e.category_key);
    catsPorAtributo.set(e.attribute_key, lista);
    attrsPorCategoria.set(e.category_key, (attrsPorCategoria.get(e.category_key) ?? 0) + 1);
  }

  const categorias: CategoriaTaxonomia[] = (
    (catsRes.data ?? []) as Array<
      Omit<CategoriaTaxonomia, "productos" | "atributos"> & {
        n_productos?: Array<{ count: number }>;
      }
    >
  ).map(({ n_productos, ...c }) => ({
    ...c,
    productos: contar(n_productos),
    atributos: attrsPorCategoria.get(c.key) ?? 0,
  }));

  const atributos: AtributoTaxonomia[] = (
    (attrsRes.data ?? []) as Array<
      Omit<AtributoTaxonomia, "productos" | "categorias"> & {
        n_productos?: Array<{ count: number }>;
      }
    >
  ).map(({ n_productos, ...a }) => ({
    ...a,
    productos: contar(n_productos),
    categorias: catsPorAtributo.get(a.key) ?? [],
  }));

  return {
    categorias,
    atributos,
    error: errores.length > 0 ? errores.join(" · ") : null,
  };
}
