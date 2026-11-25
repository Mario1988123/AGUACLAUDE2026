import "server-only";
/**
 * Catálogo maestro — LECTURAS para la lista y la ficha del superadmin.
 *
 * Todo con el admin client tras comprobar superadmin. Filtros y paginación en
 * el servidor (PostgREST corta en 1.000 filas: nunca se trae la tabla entera),
 * recuentos con `count` y URLs firmadas del bucket privado `catalog-global` en
 * UNA llamada por página (`createSignedUrls`), siempre sobre la miniatura.
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import {
  apartadoDeKind,
  agruparEfectivo,
  esUuid,
  ESTADOS_LISTA,
  type EstadoLista,
  type FiltrosLista,
  type TipoLista,
} from "./catalogo-etiquetas";

const BUCKET = "catalog-global";
const FIRMA_SEGUNDOS = 3600;
export const TAMANO_PAGINA = 48;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function asegurarSuperadmin(): Promise<void> {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
}

/** Firma en lote. Devuelve ruta → URL (las que fallen no aparecen). */
async function firmarRutas(admin: Admin, rutas: (string | null | undefined)[]) {
  const unicas = Array.from(new Set(rutas.filter((r): r is string => !!r)));
  const mapa = new Map<string, string>();
  if (unicas.length === 0) return mapa;
  // Tramos de 200 para no hacer cuerpos enormes.
  for (let i = 0; i < unicas.length; i += 200) {
    const tramo = unicas.slice(i, i + 200);
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(tramo, FIRMA_SEGUNDOS);
    if (error) {
      console.error("[catalogo-lectura] createSignedUrls:", error.message);
      continue;
    }
    for (const d of (data ?? []) as Array<{ path: string | null; signedUrl: string | null; error: string | null }>) {
      if (d.path && d.signedUrl && !d.error) mapa.set(d.path, d.signedUrl);
    }
  }
  return mapa;
}

/** Miniatura principal de cada producto: thumb de la foto principal; si no
 *  hay fila de foto principal, el `main_image_path` (fotos subidas a mano). */
async function rutasMiniatura(
  admin: Admin,
  productos: Array<{ id: string; main_image_path: string | null }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = productos.map((p) => p.id);
  if (ids.length > 0) {
    const { data, error } = await admin
      .from("catalog_product_photos")
      .select("catalog_product_id, storage_path, thumb_path")
      .in("catalog_product_id", ids)
      .eq("is_main", true);
    if (error) console.error("[catalogo-lectura] fotos principales:", error.message);
    for (const f of (data ?? []) as Array<{
      catalog_product_id: string;
      storage_path: string;
      thumb_path: string | null;
    }>) {
      if (!out.has(f.catalog_product_id)) {
        out.set(f.catalog_product_id, f.thumb_path ?? f.storage_path);
      }
    }
  }
  for (const p of productos) {
    if (!out.has(p.id) && p.main_image_path) out.set(p.id, p.main_image_path);
  }
  return out;
}

// =============================================================================
// LISTA
// =============================================================================

export function leerFiltros(sp: Record<string, string | string[] | undefined>): FiltrosLista {
  const uno = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const tipoRaw = uno("tipo");
  const tipo: TipoLista =
    tipoRaw === "recambios" || tipoRaw === "todos" ? tipoRaw : "equipos";
  const estadoRaw = uno("estado") as EstadoLista;
  const page = Math.max(1, Math.min(1000, parseInt(uno("page"), 10) || 1));
  return {
    tipo,
    fab: esUuid(uno("fab")) ? uno("fab") : "",
    cat: uno("cat").slice(0, 80),
    fam: uno("fam").slice(0, 120),
    gama: esUuid(uno("gama")) ? uno("gama") : "",
    estado: ESTADOS_LISTA.includes(estadoRaw) ? estadoRaw : "",
    q: uno("q").slice(0, 80),
    agrupar: uno("agrupar") === "1",
    vista: uno("vista") === "rejilla" ? "rejilla" : uno("vista") === "lista" ? "lista" : "",
    page,
  };
}

export interface ItemLista {
  id: string;
  nombre: string;
  modelo: string | null;
  rasgos: string | null;
  ref: string;
  kind: string;
  categoria: string | null;
  fabricante: string | null;
  familia: string | null;
  gamaNombre: string | null;
  /** Clave de su categoría y de la raíz (para el color del mapa). */
  categoriaKey: string | null;
  categoriaRaiz: string | null;
  /** Es variante de otra (no cabeza). */
  esVariante: boolean;
  /** Nº de productos de su gama (cabeza incluida). 0 si no tiene gama. */
  variantes: number;
  empresas: number;
  /** Completitud: nº de fotos, de valores de característica y de documentos. */
  fotos: number;
  atributos: number;
  documentos: number;
  version: number;
  activo: boolean;
  descatalogado: boolean;
  cambiosSinPublicar: boolean;
  miniatura: string | null;
}

export interface CategoriaFiltro {
  key: string;
  nombre: string;
  padre: string | null;
  total: number;
}

export interface ResultadoLista {
  items: ItemLista[];
  total: number;
  categorias: CategoriaFiltro[];
  familias: { nombre: string; total: number }[];
  fabricantes: { id: string; nombre: string }[];
  gamas: { id: string; nombre: string; total: number }[];
  /** Solo en el kiosco: nº de recambios y consumibles. */
  totalRecambios: number;
  error: string | null;
}

/** Limpia la búsqueda para meterla dentro de un `or()` de PostgREST. */
function limpiarBusqueda(s: string): string {
  return s.replace(/[%_*,()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

function selectConEmbeds(base: string, estado: EstadoLista): string {
  if (estado === "incompletos") return `${base}, catalog_product_attributes!left(id)`;
  if (estado === "sin_importar") return `${base}, products!left(id)`;
  return base;
}

interface OpcionesFiltro {
  sinCategoria?: boolean;
  categorias?: string[];
  idsGama?: string[] | null;
  /** Solo cabezas de gama y sueltos. */
  agrupar?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltros(q: any, f: FiltrosLista, o: OpcionesFiltro): any {
  if (f.tipo === "equipos") q = q.not("kind", "in", "(spare_part,consumable)");
  else if (f.tipo === "recambios") q = q.in("kind", ["spare_part", "consumable"]);
  if (f.fab) q = q.eq("manufacturer_id", f.fab);
  if (!o.sinCategoria) {
    if (o.categorias && o.categorias.length > 0) q = q.in("category_global_key", o.categorias);
    if (f.fam) q = q.eq("familia_proveedor", f.fam);
  }
  if (o.idsGama) q = q.in("id", o.idsGama.length > 0 ? o.idsGama : ["00000000-0000-0000-0000-000000000000"]);
  switch (f.estado) {
    case "activos":
      q = q.eq("is_active", true);
      break;
    case "inactivos":
      q = q.eq("is_active", false);
      break;
    case "descatalogados":
      q = q.eq("descatalogado", true);
      break;
    case "incompletos":
      q = q.or("main_image_path.is.null,catalog_product_attributes.is.null");
      break;
    case "sin_importar":
      q = q.is("products", null);
      break;
  }
  const s = limpiarBusqueda(f.q);
  if (s) {
    q = q.or(
      `name.ilike."%${s}%",modelo.ilike."%${s}%",supplier_reference.ilike."%${s}%"`,
    );
  }
  if (o.agrupar) q = q.is("gama_id", null);
  return q;
}

export async function leerListaMaestro(
  f: FiltrosLista,
  opciones: { kiosco?: boolean } = {},
): Promise<ResultadoLista> {
  await asegurarSuperadmin();
  const admin: Admin = createAdminClient();

  // ---- Catálogos auxiliares (pocas filas)
  const [catsRes, fabsRes, filasGama] = await Promise.all([
    admin
      .from("product_categories_global")
      .select("key, name_es, parent_key, sort_order")
      .order("sort_order")
      .order("name_es"),
    admin.from("manufacturers").select("id, name").order("sort_order").order("name"),
    fetchAllRows<{ gama_id: string }>(
      (from, to) =>
        admin
          .from("catalog_products")
          .select("gama_id")
          .not("gama_id", "is", null)
          .order("id")
          .range(from, to),
      { label: "catalogo-lectura:gamas" },
    ),
  ]);
  const cats = (catsRes.data ?? []) as Array<{
    key: string;
    name_es: string;
    parent_key: string | null;
  }>;
  const nombreCat = new Map(cats.map((c) => [c.key, c.name_es]));
  const padreCat = new Map(cats.map((c) => [c.key, c.parent_key ?? c.key]));
  const fabricantes = ((fabsRes.data ?? []) as Array<{ id: string; name: string }>).map((m) => ({
    id: m.id,
    nombre: m.name,
  }));
  const nombreFab = new Map(fabricantes.map((m) => [m.id, m.nombre]));

  // Gamas: cabezas con al menos una variante.
  const variantesPorCabeza = new Map<string, number>();
  for (const r of filasGama) variantesPorCabeza.set(r.gama_id, (variantesPorCabeza.get(r.gama_id) ?? 0) + 1);
  const idsCabeza = Array.from(variantesPorCabeza.keys());
  let gamas: ResultadoLista["gamas"] = [];
  const nombreGama = new Map<string, string>();
  if (idsCabeza.length > 0) {
    const { data } = await admin
      .from("catalog_products")
      .select("id, name, modelo, supplier_reference")
      .in("id", idsCabeza);
    for (const g of (data ?? []) as Array<{
      id: string;
      name: string;
      modelo: string | null;
      supplier_reference: string;
    }>) {
      nombreGama.set(g.id, g.modelo || g.name);
    }
    gamas = idsCabeza
      .map((id) => ({
        id,
        nombre: nombreGama.get(id) ?? "—",
        total: (variantesPorCabeza.get(id) ?? 0) + 1,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }
  let idsDeLaGama: string[] | null = null;
  if (f.gama) {
    const { data } = await admin
      .from("catalog_products")
      .select("id")
      .or(`id.eq.${f.gama},gama_id.eq.${f.gama}`);
    idsDeLaGama = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  // Categoría elegida + sus hijas.
  const hijas = (key: string) => cats.filter((c) => c.parent_key === key).map((c) => c.key);
  const categoriasFiltro = f.cat ? [f.cat, ...hijas(f.cat)] : [];

  // ---- Página de resultados
  const base =
    "id, name, modelo, rasgos_identificacion, supplier_reference, kind, category_global_key, manufacturer_id, familia_proveedor, gama_id, version, is_active, descatalogado, cambios_sin_publicar, main_image_path, n_fotos:catalog_product_photos(count), n_atributos:catalog_product_attributes(count), n_documentos:catalog_product_documents(count)";
  const desde = (f.page - 1) * TAMANO_PAGINA;
  const consulta = aplicarFiltros(
    admin.from("catalog_products").select(selectConEmbeds(base, f.estado), { count: "exact" }),
    f,
    { categorias: categoriasFiltro, idsGama: idsDeLaGama, agrupar: agruparEfectivo(f) },
  )
    .order("name")
    .order("supplier_reference")
    .range(desde, desde + TAMANO_PAGINA - 1);

  // ---- Recuentos por categoría (o por familia, en recambios), con el resto de filtros.
  const contarCategoria = async (keys: string[]) => {
    const { count, error } = await aplicarFiltros(
      admin
        .from("catalog_products")
        .select(selectConEmbeds("id", f.estado), { count: "exact", head: true }),
      f,
      { categorias: keys, idsGama: idsDeLaGama },
    );
    if (error) console.error("[catalogo-lectura] recuento categoría:", error.message);
    return count ?? 0;
  };

  const sinPagina = { data: [], count: 0, error: null };
  const [pagina, recuentos, familiasFilas, totalRecambios] = await Promise.all([
    opciones.kiosco ? Promise.resolve(sinPagina) : consulta,
    f.tipo === "recambios"
      ? Promise.resolve([] as number[])
      : Promise.all(cats.map((c) => contarCategoria([c.key]))),
    f.tipo === "recambios"
      ? fetchAllRows<{ familia_proveedor: string | null }>(
          (from, to) =>
            aplicarFiltros(
              admin
                .from("catalog_products")
                .select(selectConEmbeds("id, familia_proveedor", f.estado)),
              f,
              { sinCategoria: true, idsGama: idsDeLaGama },
            )
              .order("id")
              .range(from, to),
          { label: "catalogo-lectura:familias" },
        )
      : Promise.resolve([] as Array<{ familia_proveedor: string | null }>),
    opciones.kiosco
      ? admin
          .from("catalog_products")
          .select("id", { count: "exact", head: true })
          .in("kind", ["spare_part", "consumable"])
          .then((r: { count: number | null }) => r.count ?? 0)
      : Promise.resolve(0),
  ]);

  const error = (pagina.error as { message?: string } | null)?.message ?? null;
  if (error) console.error("[catalogo-lectura] lista:", error);

  // Categorías: total propio + hijas.
  const propio = new Map<string, number>();
  cats.forEach((c, i) => propio.set(c.key, recuentos[i] ?? 0));
  const categorias: CategoriaFiltro[] = cats
    .map((c) => ({
      key: c.key,
      nombre: c.name_es,
      padre: c.parent_key,
      total:
        (propio.get(c.key) ?? 0) +
        (c.parent_key ? 0 : hijas(c.key).reduce((s, k) => s + (propio.get(k) ?? 0), 0)),
    }))
    .filter((c) => c.total > 0 || c.key === f.cat);

  const porFamilia = new Map<string, number>();
  for (const r of familiasFilas) {
    const k = r.familia_proveedor ?? "";
    porFamilia.set(k, (porFamilia.get(k) ?? 0) + 1);
  }
  const familias = Array.from(porFamilia.entries())
    .filter(([k]) => k !== "")
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));

  const filas = (pagina.data ?? []) as Array<{
    id: string;
    name: string;
    modelo: string | null;
    rasgos_identificacion: string | null;
    supplier_reference: string;
    kind: string;
    category_global_key: string | null;
    manufacturer_id: string | null;
    familia_proveedor: string | null;
    gama_id: string | null;
    version: number;
    is_active: boolean;
    descatalogado: boolean;
    cambios_sin_publicar: boolean;
    main_image_path: string | null;
    n_fotos?: Array<{ count: number }>;
    n_atributos?: Array<{ count: number }>;
    n_documentos?: Array<{ count: number }>;
  }>;
  const contar = (v?: Array<{ count: number }>) => v?.[0]?.count ?? 0;

  // ---- Extras de la página: miniaturas, empresas
  const ids = filas.map((r) => r.id);
  const [miniRutas, enlaces] = await Promise.all([
    rutasMiniatura(admin, filas),
    ids.length > 0
      ? fetchAllRows<{ catalog_product_id: string; company_id: string }>(
          (from, to) =>
            admin
              .from("products")
              .select("catalog_product_id, company_id")
              .in("catalog_product_id", ids)
              .order("id")
              .range(from, to),
          { label: "catalogo-lectura:empresas" },
        )
      : Promise.resolve([]),
  ]);
  const firmas = await firmarRutas(admin, Array.from(miniRutas.values()));
  const empresasPor = new Map<string, Set<string>>();
  for (const e of enlaces) {
    if (!empresasPor.has(e.catalog_product_id)) empresasPor.set(e.catalog_product_id, new Set());
    empresasPor.get(e.catalog_product_id)!.add(e.company_id);
  }

  const items: ItemLista[] = filas.map((r) => {
    const cabeza = r.gama_id ?? r.id;
    const nVar = variantesPorCabeza.get(cabeza) ?? 0;
    const ruta = miniRutas.get(r.id);
    return {
      id: r.id,
      nombre: r.name,
      modelo: r.modelo,
      rasgos: r.rasgos_identificacion,
      ref: r.supplier_reference,
      kind: r.kind,
      categoria: r.category_global_key ? nombreCat.get(r.category_global_key) ?? null : null,
      fabricante: r.manufacturer_id ? nombreFab.get(r.manufacturer_id) ?? null : null,
      familia: r.familia_proveedor,
      gamaNombre: nVar > 0 ? nombreGama.get(cabeza) ?? null : null,
      categoriaKey: r.category_global_key,
      categoriaRaiz: r.category_global_key ? padreCat.get(r.category_global_key) ?? r.category_global_key : null,
      esVariante: r.gama_id != null,
      variantes: nVar > 0 ? nVar + 1 : 0,
      empresas: empresasPor.get(r.id)?.size ?? 0,
      fotos: contar(r.n_fotos),
      atributos: contar(r.n_atributos),
      documentos: contar(r.n_documentos),
      version: r.version,
      activo: r.is_active,
      descatalogado: r.descatalogado,
      cambiosSinPublicar: r.cambios_sin_publicar,
      miniatura: ruta ? firmas.get(ruta) ?? null : null,
    };
  });

  return {
    items,
    total: pagina.count ?? 0,
    categorias,
    familias,
    fabricantes,
    gamas,
    totalRecambios: totalRecambios as number,
    error,
  };
}

// =============================================================================
// FICHA
// =============================================================================

export interface FotoFicha {
  id: string;
  tipo: string;
  etiqueta: string | null;
  alt: string | null;
  url: string | null;
  miniatura: string | null;
  ancho: number | null;
  alto: number | null;
  principal: boolean;
}

export interface VentajaFicha {
  id: string;
  titulo: string;
  descripcion: string | null;
  icono: string | null;
}

export interface AtributoFicha {
  clave: string;
  nombre: string;
  grupo: string | null;
  unidad: string | null;
  tipoDato: string;
  valorTexto: string | null;
  valorNumero: number | null;
  valorBooleano: boolean | null;
  orden: number;
}

export interface ProductoMini {
  id: string;
  nombre: string;
  ref: string;
  kind: string;
  rasgos: string | null;
  miniatura: string | null;
  cantidad: number | null;
  notas: string | null;
}

export interface DocumentoFicha {
  id: string;
  apartado: string;
  kind: string;
  titulo: string;
  idioma: string | null;
  tamano: number | null;
  url: string | null;
}

export interface EmpresaFicha {
  productoId: string;
  empresaId: string;
  empresa: string;
  nombreEnEmpresa: string;
  versionSincronizada: number | null;
  alta: string | null;
}

export interface FichaMaestro {
  id: string;
  nombre: string;
  modelo: string | null;
  ref: string;
  kind: string;
  rasgos: string | null;
  fabricante: string | null;
  categoria: string | null;
  categoriaPadre: string | null;
  familia: string | null;
  catalogosProveedor: string[];
  descCorta: string | null;
  descLarga: string | null;
  anchoMm: number | null;
  altoMm: number | null;
  fondoMm: number | null;
  pesoG: number | null;
  version: number;
  activo: boolean;
  descatalogado: boolean;
  cambiosSinPublicar: boolean;
  fotos: FotoFicha[];
  ventajas: VentajaFicha[];
  atributos: AtributoFicha[];
  variantes: ProductoMini[];
  recambios: ProductoMini[];
  usadoEn: ProductoMini[];
  documentos: DocumentoFicha[];
  empresas: EmpresaFicha[];
}

export async function leerFichaMaestro(id: string): Promise<FichaMaestro | null> {
  await asegurarSuperadmin();
  if (!esUuid(id)) return null;
  const admin: Admin = createAdminClient();

  const { data: p, error: errP } = await admin
    .from("catalog_products")
    .select(
      "id, manufacturer_id, supplier_reference, name, modelo, kind, category_global_key, short_description, long_description, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, main_image_path, version, is_active, gama_id, rasgos_identificacion, familia_proveedor, catalogos_proveedor, descatalogado, cambios_sin_publicar",
    )
    .eq("id", id)
    .maybeSingle();
  if (errP) throw new Error(errP.message);
  if (!p) return null;
  const prod = p as {
    id: string;
    manufacturer_id: string | null;
    supplier_reference: string;
    name: string;
    modelo: string | null;
    kind: string;
    category_global_key: string | null;
    short_description: string | null;
    long_description: string | null;
    dim_width_mm: number | null;
    dim_height_mm: number | null;
    dim_depth_mm: number | null;
    weight_grams: number | null;
    main_image_path: string | null;
    version: number;
    is_active: boolean;
    gama_id: string | null;
    rasgos_identificacion: string | null;
    familia_proveedor: string | null;
    catalogos_proveedor: string[] | null;
    descatalogado: boolean;
    cambios_sin_publicar: boolean;
  };
  const cabeza = prod.gama_id ?? prod.id;

  const [fab, cat, fotosR, ventR, attrR, docsR, empR, gamaR, compEqR, compRecR] = await Promise.all([
    prod.manufacturer_id
      ? admin.from("manufacturers").select("name").eq("id", prod.manufacturer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    prod.category_global_key
      ? admin
          .from("product_categories_global")
          .select("name_es, parent_key")
          .eq("key", prod.category_global_key)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("catalog_product_photos")
      .select("id, storage_path, thumb_path, tipo_foto, etiqueta, alt_text, is_main, display_order, width_px, height_px")
      .eq("catalog_product_id", id)
      .order("is_main", { ascending: false })
      .order("display_order")
      .limit(500),
    admin
      .from("catalog_product_highlights")
      .select("id, titulo, descripcion, icon_path, display_order")
      .eq("catalog_product_id", id)
      .order("display_order")
      .limit(200),
    admin
      .from("catalog_product_attributes")
      .select("attribute_global_key, value_text, value_number, value_boolean, display_order")
      .eq("catalog_product_id", id)
      .order("display_order")
      .limit(500),
    admin
      .from("catalog_product_documents")
      .select("id, kind, title, storage_path, file_size_bytes, idioma, apartado, display_order")
      .eq("catalog_product_id", id)
      .order("display_order")
      .limit(500),
    fetchAllRows<{
      id: string;
      company_id: string;
      name: string;
      catalog_version_synced: number | null;
      created_at: string | null;
    }>(
      (from, to) =>
        admin
          .from("products")
          .select("id, company_id, name, catalog_version_synced, created_at")
          .eq("catalog_product_id", id)
          .order("created_at")
          .range(from, to),
      { label: "catalogo-lectura:empresas-ficha" },
    ),
    admin
      .from("catalog_products")
      .select("id, name, supplier_reference, kind, rasgos_identificacion, main_image_path, gama_id")
      .or(`id.eq.${cabeza},gama_id.eq.${cabeza}`)
      .order("supplier_reference")
      .limit(500),
    admin
      .from("catalog_product_compatibilities")
      .select("spare_part_catalog_id, cantidad, display_order, notes")
      .eq("equipment_catalog_id", id)
      .order("display_order")
      .limit(1000),
    admin
      .from("catalog_product_compatibilities")
      .select("equipment_catalog_id, cantidad, display_order, notes")
      .eq("spare_part_catalog_id", id)
      .order("display_order")
      .limit(1000),
  ]);

  // Categoría padre (solo el nombre)
  const catRow = (cat.data ?? null) as { name_es: string; parent_key: string | null } | null;
  let categoriaPadre: string | null = null;
  if (catRow?.parent_key) {
    const { data } = await admin
      .from("product_categories_global")
      .select("name_es")
      .eq("key", catRow.parent_key)
      .maybeSingle();
    categoriaPadre = (data as { name_es: string } | null)?.name_es ?? null;
  }

  // Atributos + su definición global
  const valores = (attrR.data ?? []) as Array<{
    attribute_global_key: string;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    display_order: number;
  }>;
  const meta = new Map<
    string,
    { name_es: string; data_type: string; unit: string | null; grupo: string | null; sort_order: number }
  >();
  if (valores.length > 0) {
    const { data } = await admin
      .from("product_attributes_global")
      .select("key, name_es, data_type, unit, grupo, sort_order")
      .in(
        "key",
        valores.map((v) => v.attribute_global_key),
      );
    for (const m of (data ?? []) as Array<{
      key: string;
      name_es: string;
      data_type: string;
      unit: string | null;
      grupo: string | null;
      sort_order: number;
    }>)
      meta.set(m.key, m);
  }
  const atributos: AtributoFicha[] = valores.map((v) => {
    const m = meta.get(v.attribute_global_key);
    return {
      clave: v.attribute_global_key,
      nombre: m?.name_es ?? v.attribute_global_key,
      grupo: m?.grupo ?? null,
      unidad: m?.unit ?? null,
      tipoDato: m?.data_type ?? "text",
      valorTexto: v.value_text,
      valorNumero: v.value_number,
      valorBooleano: v.value_boolean,
      orden: v.display_order ?? m?.sort_order ?? 0,
    };
  });

  // Productos relacionados (gama, recambios, equipos donde se usa)
  type FilaMini = {
    id: string;
    name: string;
    supplier_reference: string;
    kind: string;
    rasgos_identificacion: string | null;
    main_image_path: string | null;
  };
  const gamaFilas = (gamaR.data ?? []) as Array<FilaMini & { gama_id: string | null }>;
  const compEq = (compEqR.data ?? []) as Array<{
    spare_part_catalog_id: string;
    cantidad: number | null;
    display_order: number;
    notes: string | null;
  }>;
  const compRec = (compRecR.data ?? []) as Array<{
    equipment_catalog_id: string;
    cantidad: number | null;
    display_order: number;
    notes: string | null;
  }>;
  const idsRel = Array.from(
    new Set([...compEq.map((c) => c.spare_part_catalog_id), ...compRec.map((c) => c.equipment_catalog_id)]),
  );
  const relFilas: FilaMini[] = [];
  for (let i = 0; i < idsRel.length; i += 150) {
    const { data } = await admin
      .from("catalog_products")
      .select("id, name, supplier_reference, kind, rasgos_identificacion, main_image_path")
      .in("id", idsRel.slice(i, i + 150));
    relFilas.push(...((data ?? []) as FilaMini[]));
  }
  const relPorId = new Map(relFilas.map((r) => [r.id, r]));

  // Variantes solo si hay más de un producto en la gama.
  const filasVariantes = gamaFilas.length > 1 ? gamaFilas : [];
  const miniRutas = await rutasMiniatura(admin, [...filasVariantes, ...relFilas]);

  // Fotos y documentos
  const fotosFilas = (fotosR.data ?? []) as Array<{
    id: string;
    storage_path: string;
    thumb_path: string | null;
    tipo_foto: string | null;
    etiqueta: string | null;
    alt_text: string | null;
    is_main: boolean;
    display_order: number;
    width_px: number | null;
    height_px: number | null;
  }>;
  const ventajasFilas = (ventR.data ?? []) as Array<{
    id: string;
    titulo: string;
    descripcion: string | null;
    icon_path: string | null;
  }>;
  const docsFilas = (docsR.data ?? []) as Array<{
    id: string;
    kind: string;
    title: string;
    storage_path: string;
    file_size_bytes: number | null;
    idioma: string | null;
    apartado: string | null;
  }>;

  // Empresas
  const idsEmpresa = Array.from(new Set(empR.map((e) => e.company_id)));
  const nombreEmpresa = new Map<string, string>();
  if (idsEmpresa.length > 0) {
    const { data } = await admin.from("companies").select("id, name").in("id", idsEmpresa);
    for (const c of (data ?? []) as Array<{ id: string; name: string }>) nombreEmpresa.set(c.id, c.name);
  }

  // Una sola tanda de firmas para todo lo que se pinta.
  const firmas = await firmarRutas(admin, [
    ...fotosFilas.flatMap((f) => [f.storage_path, f.thumb_path]),
    prod.main_image_path,
    ...ventajasFilas.map((v) => v.icon_path),
    ...docsFilas.map((d) => d.storage_path),
    ...Array.from(miniRutas.values()),
  ]);
  const firma = (r: string | null | undefined) => (r ? firmas.get(r) ?? null : null);

  let fotos: FotoFicha[] = fotosFilas.map((f) => ({
    id: f.id,
    tipo: f.tipo_foto ?? (f.is_main ? "principal" : "otras"),
    etiqueta: f.etiqueta,
    alt: f.alt_text,
    url: firma(f.storage_path),
    miniatura: firma(f.thumb_path) ?? firma(f.storage_path),
    ancho: f.width_px,
    alto: f.height_px,
    principal: f.is_main,
  }));
  // Producto antiguo con main_image_path pero sin fila de foto.
  if (fotos.length === 0 && prod.main_image_path) {
    const u = firma(prod.main_image_path);
    fotos = [
      { id: "principal", tipo: "principal", etiqueta: null, alt: prod.name, url: u, miniatura: u, ancho: null, alto: null, principal: true },
    ];
  }

  const mini = (r: FilaMini, extra?: { cantidad: number | null; notes: string | null }): ProductoMini => {
    const ruta = miniRutas.get(r.id);
    return {
      id: r.id,
      nombre: r.name,
      ref: r.supplier_reference,
      kind: r.kind,
      rasgos: r.rasgos_identificacion,
      miniatura: ruta ? firma(ruta) : null,
      cantidad: extra?.cantidad ?? null,
      notas: extra?.notes ?? null,
    };
  };

  return {
    id: prod.id,
    nombre: prod.name,
    modelo: prod.modelo,
    ref: prod.supplier_reference,
    kind: prod.kind,
    rasgos: prod.rasgos_identificacion,
    fabricante: (fab.data as { name: string } | null)?.name ?? null,
    categoria: catRow?.name_es ?? null,
    categoriaPadre,
    familia: prod.familia_proveedor,
    catalogosProveedor: prod.catalogos_proveedor ?? [],
    descCorta: prod.short_description,
    descLarga: prod.long_description,
    anchoMm: prod.dim_width_mm,
    altoMm: prod.dim_height_mm,
    fondoMm: prod.dim_depth_mm,
    pesoG: prod.weight_grams,
    version: prod.version,
    activo: prod.is_active,
    descatalogado: prod.descatalogado,
    cambiosSinPublicar: prod.cambios_sin_publicar,
    fotos,
    ventajas: ventajasFilas.map((v) => ({
      id: v.id,
      titulo: v.titulo,
      descripcion: v.descripcion,
      icono: firma(v.icon_path),
    })),
    atributos,
    variantes: filasVariantes.map((r) => mini(r)),
    recambios: compEq
      .map((c) => {
        const r = relPorId.get(c.spare_part_catalog_id);
        return r ? mini(r, { cantidad: c.cantidad, notes: c.notes }) : null;
      })
      .filter((x): x is ProductoMini => !!x),
    usadoEn: compRec
      .map((c) => {
        const r = relPorId.get(c.equipment_catalog_id);
        return r ? mini(r, { cantidad: c.cantidad, notes: c.notes }) : null;
      })
      .filter((x): x is ProductoMini => !!x)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    documentos: docsFilas.map((d) => ({
      id: d.id,
      apartado: d.apartado ?? apartadoDeKind(d.kind),
      kind: d.kind,
      titulo: d.title,
      idioma: d.idioma,
      tamano: d.file_size_bytes,
      url: firma(d.storage_path),
    })),
    empresas: empR.map((e) => ({
      productoId: e.id,
      empresaId: e.company_id,
      empresa: nombreEmpresa.get(e.company_id) ?? "—",
      nombreEnEmpresa: e.name,
      versionSincronizada: e.catalog_version_synced,
      alta: e.created_at,
    })),
  };
}
