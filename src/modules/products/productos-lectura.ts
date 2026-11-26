import "server-only";
/**
 * Productos de la EMPRESA — LECTURAS de la ficha (/productos/[id]) y de la
 * lista por categorías (/productos). Devuelven las mismas formas que pintan los
 * componentes del superadmin (galería, ficha técnica, variantes, recambios,
 * documentos, filas y tarjetas), para que la ficha de la empresa se vea igual
 * que la del catálogo maestro.
 *
 * Todo con el cliente de sesión (RLS acota a la empresa). El admin client solo
 * firma las rutas de documentos que la propia RLS ya ha devuelto.
 */

import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { apartadoDeKind } from "@/modules/superadmin/catalogo/catalogo-etiquetas";
import type {
  DocumentoFicha,
  ProductoMini,
} from "@/modules/superadmin/catalogo/catalogo-lectura";
import { hayColumnaOrigen } from "./atributos-origen";
import {
  caracteristicasDeEmpresa,
  contarGamas,
  fotosDeEmpresa,
  resumenPrecio,
  type CaracteristicaEmpresa,
  type FilaAtributoEmpresa,
  type FilaImagenEmpresa,
  type FilaPlanPrecio,
  type FilaValorEmpresa,
  type FotoEmpresa,
  type ProductoListaEmpresa,
} from "./productos-vista";

const BUCKET_FOTOS = "product-images";
const BUCKET_DOCS = "product-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

function trozos<T>(lista: T[], n = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

function urlPublicaDe(supabase: Cliente) {
  return (ruta: string) =>
    (supabase.storage.from(BUCKET_FOTOS).getPublicUrl(ruta) as { data: { publicUrl: string } }).data
      .publicUrl;
}

// =============================================================================
// FICHA
// =============================================================================

export interface CategoriaEmpresa {
  id: string;
  nombre: string;
  padreId: string | null;
  claveGlobal: string | null;
  tipoEquipo: string | null;
}

export interface FichaEmpresa {
  id: string;
  nombre: string;
  ref: string | null;
  refProveedor: string | null;
  kind: string;
  rasgos: string | null;
  categoria: CategoriaEmpresa | null;
  categoriaPadre: string | null;
  descCorta: string | null;
  descLarga: string | null;
  anchoMm: number | null;
  altoMm: number | null;
  fondoMm: number | null;
  pesoG: number | null;
  activo: boolean;
  gamaId: string | null;
  catalogoId: string | null;
  garantia: { general: number | null; electronica: number | null; carcasa: number | null };
  fotos: FotoEmpresa[];
  /** Todas, visibles y ocultas (la ficha de lectura filtra las visibles). */
  caracteristicas: CaracteristicaEmpresa[];
  hayOrigen: boolean;
  variantes: ProductoMini[];
  recambios: ProductoMini[];
  /** Los recambios son los de la gama (la variante no tiene propios). */
  recambiosDeGama: boolean;
  documentos: DocumentoFicha[];
  precio: { contadoCents: number | null; desdeMesCents: number | null };
  costeCents: number | null;
  stockGestionado: boolean;
  stockMin: number;
  /** Fila completa de products (para Editar, que reutiliza los paneles de hoy). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fila: any;
}

export async function leerCategoriasEmpresa(supabase?: Cliente): Promise<CategoriaEmpresa[]> {
  const sb: Cliente = supabase ?? (await createClient());
  const [{ data: cats, error }, { data: globales }] = await Promise.all([
    sb
      .from("product_categories")
      .select("id, name, parent_id, cloned_from_global_id, tipo_equipo, sort_order, is_active")
      .order("sort_order")
      .order("name"),
    sb.from("product_categories_global").select("id, key"),
  ]);
  if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`);
  const claveDe = new Map(
    ((globales ?? []) as Array<{ id: string; key: string }>).map((g) => [g.id, g.key]),
  );
  return (
    (cats ?? []) as Array<{
      id: string;
      name: string;
      parent_id: string | null;
      cloned_from_global_id: string | null;
      tipo_equipo: string | null;
    }>
  ).map((c) => ({
    id: c.id,
    nombre: c.name,
    padreId: c.parent_id,
    claveGlobal: c.cloned_from_global_id ? (claveDe.get(c.cloned_from_global_id) ?? null) : null,
    tipoEquipo: c.tipo_equipo,
  }));
}

/** Lee las características (valores + definición + grupo global) de un producto. */
export async function leerCaracteristicasEmpresa(
  productId: string,
  supabase?: Cliente,
): Promise<{ caracteristicas: CaracteristicaEmpresa[]; hayOrigen: boolean }> {
  const sb: Cliente = supabase ?? (await createClient());
  const hayOrigen = await hayColumnaOrigen(sb);
  const cols =
    "id, attribute_id, value_text, value_number, value_boolean, value_json, is_visible, is_featured, display_order" +
    (hayOrigen ? ", origen" : "");
  const { data: vals, error } = await sb
    .from("product_attribute_values")
    .select(cols)
    .eq("product_id", productId)
    .order("display_order")
    .limit(1000);
  if (error) throw new Error(`No se pudieron leer las características: ${error.message}`);
  const valores = (vals ?? []) as FilaValorEmpresa[];
  if (valores.length === 0) return { caracteristicas: [], hayOrigen };

  const ids = Array.from(new Set(valores.map((v) => v.attribute_id)));
  const atributos = new Map<string, FilaAtributoEmpresa>();
  for (const t of trozos(ids)) {
    const { data, error: e2 } = await sb
      .from("product_attributes")
      .select("id, key, name, data_type, unit, grupo, sort_order, cloned_from_global_id")
      .in("id", t);
    if (e2) throw new Error(`No se pudieron leer los atributos: ${e2.message}`);
    for (const a of (data ?? []) as FilaAtributoEmpresa[]) atributos.set(a.id, a);
  }
  const idsGlobales = Array.from(
    new Set(
      Array.from(atributos.values())
        .filter((a) => !a.grupo && a.cloned_from_global_id)
        .map((a) => a.cloned_from_global_id as string),
    ),
  );
  const grupoGlobal = new Map<string, string | null>();
  for (const t of trozos(idsGlobales)) {
    const { data } = await sb.from("product_attributes_global").select("id, grupo").in("id", t);
    for (const g of (data ?? []) as Array<{ id: string; grupo: string | null }>)
      grupoGlobal.set(g.id, g.grupo);
  }
  return { caracteristicas: caracteristicasDeEmpresa(valores, atributos, grupoGlobal), hayOrigen };
}

export async function leerFichaEmpresa(id: string): Promise<FichaEmpresa | null> {
  await requireSession();
  const supabase: Cliente = await createClient();

  const { data: p, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    // id con formato inválido → no existe.
    if (/invalid input syntax/i.test(error.message ?? "")) return null;
    throw new Error(error.message);
  }
  if (!p) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prod = p as any;
  const cabeza: string = prod.gama_id ?? prod.id;
  const urlPublica = urlPublicaDe(supabase);

  const [categorias, imgsR, caract, docsR, gamaR, planesR] = await Promise.all([
    leerCategoriasEmpresa(supabase).catch(() => [] as CategoriaEmpresa[]),
    supabase
      .from("product_images")
      .select("id, storage_path, tipo_foto, alt_text, is_main, display_order, width_px, height_px")
      .eq("product_id", id)
      .order("display_order")
      .limit(500),
    leerCaracteristicasEmpresa(id, supabase),
    supabase
      .from("product_documents")
      .select("id, kind, title, storage_path, file_size_bytes, display_order, created_at")
      .eq("product_id", id)
      .order("display_order")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("products")
      .select("id, name, internal_reference, supplier_reference, kind, rasgos_identificacion, main_image_url, gama_id")
      .or(`id.eq.${cabeza},gama_id.eq.${cabeza}`)
      .is("deleted_at", null)
      .order("name")
      .limit(500),
    supabase
      .from("product_pricing_plans")
      .select(
        "plan_type, is_active, total_price_cents, total_price_individual_cents, monthly_price_cents, monthly_price_individual_cents",
      )
      .eq("product_id", id),
  ]);
  if (imgsR.error) console.error("[productos-lectura] fotos:", imgsR.error.message);
  if (docsR.error) console.error("[productos-lectura] documentos:", docsR.error.message);
  if (gamaR.error) console.error("[productos-lectura] gama:", gamaR.error.message);

  // Precios: si falla la consulta con las columnas duales, se cae a las antiguas.
  let planes = (planesR.data ?? []) as FilaPlanPrecio[];
  if (planesR.error) {
    const fb = await supabase
      .from("product_pricing_plans")
      .select("plan_type, total_price_cents, monthly_price_cents")
      .eq("product_id", id);
    planes = (fb.data ?? []) as FilaPlanPrecio[];
  }

  const categoria = categorias.find((c) => c.id === prod.category_id) ?? null;
  const categoriaPadre = categoria?.padreId
    ? (categorias.find((c) => c.id === categoria.padreId)?.nombre ?? null)
    : null;

  // Variantes: solo si la gama tiene más de un producto.
  type FilaGama = {
    id: string;
    name: string;
    internal_reference: string | null;
    supplier_reference: string | null;
    kind: string;
    rasgos_identificacion: string | null;
    main_image_url: string | null;
  };
  const filasGama = (gamaR.data ?? []) as FilaGama[];
  const variantes: ProductoMini[] =
    filasGama.length > 1
      ? filasGama.map((r) => ({
          id: r.id,
          nombre: r.name,
          ref: r.internal_reference ?? r.supplier_reference ?? "",
          kind: r.kind,
          rasgos: r.rasgos_identificacion,
          miniatura: r.main_image_url,
          cantidad: null,
          notas: null,
        }))
      : [];

  // Filtros y recambios (product_filter_assignments). Una variante sin filtros
  // propios usa los de su gama (filtros_efectivos).
  const leerFiltros = async (productId: string) => {
    const { data, error: e } = await supabase
      .from("product_filter_assignments")
      .select(
        "id, filter_id, stage_position, replacement_period_months, quantity_per_change, notes, product_filters ( name, filter_type, internal_reference, main_image_url )",
      )
      .eq("product_id", productId)
      .order("stage_position");
    if (e) console.error("[productos-lectura] filtros:", e.message);
    return (data ?? []) as Array<{
      id: string;
      filter_id: string;
      replacement_period_months: number | null;
      quantity_per_change: number | null;
      notes: string | null;
      product_filters: {
        name: string;
        filter_type: string;
        internal_reference: string | null;
        main_image_url: string | null;
      } | null;
    }>;
  };
  let filtros = await leerFiltros(id);
  let recambiosDeGama = false;
  if (filtros.length === 0 && prod.gama_id) {
    filtros = await leerFiltros(prod.gama_id);
    recambiosDeGama = filtros.length > 0;
  }
  const recambios: ProductoMini[] = filtros.map((f) => ({
    id: f.id,
    nombre: f.product_filters?.name ?? "Filtro",
    ref: f.product_filters?.internal_reference ?? "",
    kind: "consumable",
    rasgos: f.replacement_period_months
      ? `cada ${f.replacement_period_months} ${f.replacement_period_months === 1 ? "mes" : "meses"}`
      : null,
    miniatura: f.product_filters?.main_image_url ?? null,
    cantidad: f.quantity_per_change && f.quantity_per_change > 1 ? f.quantity_per_change : null,
    notas: f.notes,
  }));

  // Documentos: se firman con el admin client las rutas que la RLS ha devuelto.
  const docsFilas = (docsR.data ?? []) as Array<{
    id: string;
    kind: string;
    title: string;
    storage_path: string;
    file_size_bytes: number | null;
  }>;
  const firmas = new Map<string, string>();
  if (docsFilas.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: firmadas, error: eF } = await admin.storage
      .from(BUCKET_DOCS)
      .createSignedUrls(
        docsFilas.map((d) => d.storage_path),
        3600,
      );
    if (eF) console.error("[productos-lectura] firmar documentos:", eF.message);
    for (const d of (firmadas ?? []) as Array<{ path: string | null; signedUrl: string | null; error: string | null }>) {
      if (d.path && d.signedUrl && !d.error) firmas.set(d.path, d.signedUrl);
    }
  }

  return {
    id: prod.id,
    nombre: prod.name,
    ref: prod.internal_reference ?? null,
    refProveedor: prod.supplier_reference ?? null,
    kind: prod.kind,
    rasgos: prod.rasgos_identificacion ?? null,
    categoria,
    categoriaPadre,
    descCorta: prod.short_description ?? null,
    descLarga: prod.long_description ?? null,
    anchoMm: prod.dim_width_mm ?? null,
    altoMm: prod.dim_height_mm ?? null,
    fondoMm: prod.dim_depth_mm ?? null,
    pesoG: prod.weight_grams ?? null,
    activo: !!prod.is_active,
    gamaId: prod.gama_id ?? null,
    catalogoId: prod.catalog_product_id ?? null,
    garantia: {
      general: prod.warranty_months_general ?? null,
      electronica: prod.warranty_months_electronics ?? null,
      carcasa: prod.warranty_months_body ?? null,
    },
    fotos: fotosDeEmpresa(
      (imgsR.data ?? []) as FilaImagenEmpresa[],
      urlPublica,
      prod.main_image_url ?? null,
      prod.name,
    ),
    caracteristicas: caract.caracteristicas,
    hayOrigen: caract.hayOrigen,
    variantes,
    recambios,
    recambiosDeGama,
    documentos: docsFilas.map((d) => ({
      id: d.id,
      apartado: apartadoDeKind(d.kind),
      kind: d.kind,
      titulo: d.title,
      idioma: null,
      tamano: d.file_size_bytes,
      url: firmas.get(d.storage_path) ?? null,
    })),
    precio: resumenPrecio(planes),
    costeCents: prod.cost_cents ?? null,
    stockGestionado: !!prod.stock_managed,
    stockMin: prod.stock_min ?? 0,
    fila: prod,
  };
}

// =============================================================================
// LISTA
// =============================================================================

export interface DatosListaEmpresa {
  productos: ProductoListaEmpresa[];
  categorias: CategoriaEmpresa[];
  stock: Map<string, number>;
  /** Cabeza de gama → nº de productos de la gama. */
  gamas: Map<string, number>;
  totalFiltros: number;
}

/**
 * Todos los productos de la empresa (sin borrar), con su precio de contado y
 * su stock. Se filtra y agrupa en memoria: con miles de filas sigue siendo una
 * lectura por tramos (fetchAllRows), nunca cortada en 1.000.
 */
export async function leerListaEmpresa(): Promise<DatosListaEmpresa> {
  await requireSession();
  const supabase: Cliente = await createClient();

  const filas = await fetchAllRows<Omit<ProductoListaEmpresa, "cash_price_cents">>(
    (from, to) =>
      supabase
        .from("products")
        .select(
          "id, name, kind, category_id, internal_reference, supplier_reference, is_active, main_image_url, gama_id, rasgos_identificacion, tags, stock_managed, show_in_calculator",
        )
        .is("deleted_at", null)
        .order("name")
        .range(from, to),
    { label: "productos-lectura:lista" },
  );
  const ids = filas.map((p) => p.id);

  const precio = new Map<string, number>();
  const stock = new Map<string, number>();
  for (const t of trozos(ids, 200)) {
    const [planes, existencias] = await Promise.all([
      supabase
        .from("product_pricing_plans")
        .select("product_id, total_price_cents")
        .eq("plan_type", "cash")
        .in("product_id", t),
      supabase.from("warehouse_stock").select("product_id, quantity").in("product_id", t),
    ]);
    for (const r of (planes.data ?? []) as Array<{ product_id: string; total_price_cents: number | null }>) {
      if (r.total_price_cents != null) precio.set(r.product_id, r.total_price_cents);
    }
    for (const s of (existencias.data ?? []) as Array<{ product_id: string; quantity: number | null }>) {
      stock.set(s.product_id, (stock.get(s.product_id) ?? 0) + (s.quantity ?? 0));
    }
  }

  const [categorias, filtrosR] = await Promise.all([
    leerCategoriasEmpresa(supabase).catch(() => [] as CategoriaEmpresa[]),
    supabase
      .from("product_filters")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("deleted_at", null),
  ]);

  const productos: ProductoListaEmpresa[] = filas.map((p) => ({
    ...p,
    tags: Array.isArray(p.tags) ? p.tags : [],
    cash_price_cents: precio.get(p.id) ?? null,
  }));
  return {
    productos,
    categorias,
    stock,
    gamas: contarGamas(productos),
    totalFiltros: filtrosR.error ? 0 : (filtrosR.count ?? 0),
  };
}
