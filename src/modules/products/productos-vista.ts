/**
 * Productos de la EMPRESA — utilidades PURAS para la ficha de lectura y la
 * lista por categorías (sin base de datos, sin "server-only"): se prueban con
 * vitest y las usan tanto el lector del servidor como los componentes.
 *
 * Convierten las filas de las tablas de la empresa (products, product_images,
 * product_attribute_values + product_attributes, product_pricing_plans) en las
 * formas que pintan los componentes compartidos con el superadmin
 * (FotoGaleria, AtributoVista, ItemLista).
 */

import type { AtributoVista } from "@/modules/superadmin/catalogo/ficha-caracteristicas";
import type { FotoGaleria } from "@/modules/superadmin/catalogo/ficha-galeria";

// =============================================================================
// Fotos
// =============================================================================

/** Tipos admitidos por el CHECK de product_images.tipo_foto. */
export const TIPOS_FOTO_EMPRESA = [
  "principal",
  "ambiente",
  "medidas",
  "ficha",
  "banner",
  "proyeccion",
  "detalle",
  "despiece",
] as const;

export interface FilaImagenEmpresa {
  id: string;
  storage_path: string;
  tipo_foto: string | null;
  alt_text: string | null;
  is_main: boolean;
  display_order: number;
  width_px: number | null;
  height_px: number | null;
}

export interface FotoEmpresa extends FotoGaleria {
  principal: boolean;
}

/**
 * Fotos de la ficha: cada fila de product_images con su tipo (si no lo tiene:
 * «principal» la marcada como principal, «otras» el resto) y, si la foto
 * principal del producto (`main_image_url`) no está entre ellas, se añade
 * delante: muchos productos antiguos solo tienen esa columna.
 */
export function fotosDeEmpresa(
  filas: FilaImagenEmpresa[],
  urlPublica: (ruta: string) => string,
  mainImageUrl: string | null,
  nombre: string,
): FotoEmpresa[] {
  const ordenadas = [...filas].sort(
    (a, b) => Number(b.is_main) - Number(a.is_main) || a.display_order - b.display_order,
  );
  const fotos: FotoEmpresa[] = ordenadas.map((f) => {
    const url = urlPublica(f.storage_path);
    return {
      id: f.id,
      tipo: f.tipo_foto ?? (f.is_main ? "principal" : "otras"),
      etiqueta: null,
      alt: f.alt_text ?? nombre,
      url,
      miniatura: url,
      ancho: f.width_px,
      alto: f.height_px,
      principal: f.is_main,
    };
  });
  if (mainImageUrl && !fotos.some((f) => f.url === mainImageUrl)) {
    fotos.unshift({
      id: "principal",
      tipo: "principal",
      etiqueta: null,
      alt: nombre,
      url: mainImageUrl,
      miniatura: mainImageUrl,
      ancho: null,
      alto: null,
      principal: true,
    });
  }
  return fotos;
}

/**
 * Reparto de la galería, igual que en la ficha del maestro: arriba la
 * principal (y la de ficha); en «Imágenes del producto» el resto salvo
 * banner y proyecciones; el dibujo de medidas, aparte, junto a Físicas.
 */
export function repartirFotos<T extends FotoGaleria>(fotos: T[]) {
  const esPortada = (t: string) => t === "principal" || t === "ficha";
  const portada = fotos.some((f) => esPortada(f.tipo))
    ? fotos.filter((f) => esPortada(f.tipo))
    : fotos.slice(0, 1);
  const imagenes = fotos.filter(
    (f) => !portada.includes(f) && f.tipo !== "banner" && f.tipo !== "proyeccion",
  );
  const medidas = fotos.find((f) => f.tipo === "medidas")?.url ?? null;
  const proyecciones = fotos.filter((f) => f.tipo === "proyeccion");
  return { portada, imagenes, medidas, proyecciones };
}

// =============================================================================
// Características (atributos)
// =============================================================================

export const GRUPOS_ATRIBUTO = ["fisicas", "electricas", "tecnicas", "extra"] as const;
export type GrupoAtributo = (typeof GRUPOS_ATRIBUTO)[number];

export const GRUPO_ETIQUETA: Record<GrupoAtributo, string> = {
  fisicas: "Físicas",
  electricas: "Eléctricas",
  tecnicas: "Técnicas",
  extra: "Extra",
};

/** Origen de un valor (migración 20261129110000). Null = anterior a la marca. */
export type OrigenValor = "maestro" | "editado" | "propio" | null;

export interface FilaValorEmpresa {
  id: string;
  attribute_id: string;
  value_text: string | null;
  value_number: number | string | null;
  value_boolean: boolean | null;
  value_json: unknown;
  is_visible: boolean;
  is_featured?: boolean | null;
  display_order: number;
  origen?: string | null;
}

export interface FilaAtributoEmpresa {
  id: string;
  key: string;
  name: string;
  data_type: string;
  unit: string | null;
  grupo: string | null;
  sort_order: number;
  cloned_from_global_id: string | null;
}

export interface CaracteristicaEmpresa extends AtributoVista {
  valorId: string;
  atributoId: string;
  visible: boolean;
  /** Destacado en la ficha técnica PDF (máx. 5). */
  destacado: boolean;
  origen: OrigenValor;
  /** Viene del catálogo maestro (clonado de un atributo global). */
  heredado: boolean;
}

function esGrupo(g: string | null | undefined): g is GrupoAtributo {
  return !!g && (GRUPOS_ATRIBUTO as readonly string[]).includes(g);
}

/** value_json → texto legible (solo si no hay otro valor). */
function textoDeJson(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const partes = v.map((x) => textoDeJson(x)).filter(Boolean);
    return partes.length > 0 ? partes.join(", ") : null;
  }
  return null;
}

function aNumero(v: number | string | null): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Une valores y definiciones. El grupo sale del atributo de la empresa y, si
 * lo tiene vacío (los 60 de Infinity), del atributo global del que se clonó.
 *
 * El valor se lee de la columna que TENGA dato, sin fiarse de `data_type`:
 * un atributo de tipo número con el valor guardado en texto («220-240V~50/60Hz»)
 * se enseña igual. Así no sale vacío ni «0».
 */
export function caracteristicasDeEmpresa(
  valores: FilaValorEmpresa[],
  atributos: Map<string, FilaAtributoEmpresa>,
  grupoGlobal: Map<string, string | null>,
): CaracteristicaEmpresa[] {
  const out: CaracteristicaEmpresa[] = [];
  for (const v of valores) {
    const a = atributos.get(v.attribute_id);
    if (!a) continue;
    const g = esGrupo(a.grupo)
      ? a.grupo
      : a.cloned_from_global_id
        ? (grupoGlobal.get(a.cloned_from_global_id) ?? null)
        : null;
    const num = aNumero(v.value_number);
    const texto = v.value_text?.trim() ? v.value_text : textoDeJson(v.value_json);
    const origen =
      v.origen === "maestro" || v.origen === "editado" || v.origen === "propio" ? v.origen : null;
    out.push({
      valorId: v.id,
      atributoId: a.id,
      clave: a.key,
      nombre: a.name,
      grupo: esGrupo(g) ? g : null,
      unidad: a.unit,
      tipoDato: a.data_type,
      valorTexto: texto,
      valorNumero: num,
      valorBooleano: v.value_boolean,
      orden: v.display_order ?? a.sort_order ?? 0,
      visible: v.is_visible,
      destacado: !!v.is_featured,
      origen,
      heredado: origen === "maestro" || origen === "editado" || (!origen && !!a.cloned_from_global_id),
    });
  }
  return out.sort((x, y) => x.orden - y.orden);
}

/** Grupo efectivo para pintar y ordenar (sin grupo → Técnicas, como el maestro). */
export function grupoEfectivo(c: { grupo: string | null }): GrupoAtributo {
  return esGrupo(c.grupo) ? c.grupo : "tecnicas";
}

/**
 * Nuevo orden tras subir o bajar una característica DENTRO de su grupo.
 * Devuelve los ids de valor en el orden final (grupo a grupo: Físicas,
 * Eléctricas, Técnicas, Extra), para numerar display_order 0..n-1.
 * Si no se puede mover (primera/última del grupo o id desconocido), devuelve null.
 */
export function reordenarEnGrupo(
  lista: Array<{ valorId: string; grupo: string | null; orden: number }>,
  valorId: string,
  direccion: "subir" | "bajar",
): string[] | null {
  const porGrupo = new Map<GrupoAtributo, typeof lista>();
  for (const g of GRUPOS_ATRIBUTO) porGrupo.set(g, []);
  for (const c of [...lista].sort((a, b) => a.orden - b.orden)) {
    porGrupo.get(grupoEfectivo(c))!.push(c);
  }
  const actual = lista.find((c) => c.valorId === valorId);
  if (!actual) return null;
  const grupo = porGrupo.get(grupoEfectivo(actual))!;
  const i = grupo.findIndex((c) => c.valorId === valorId);
  const j = direccion === "subir" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= grupo.length) return null;
  [grupo[i], grupo[j]] = [grupo[j]!, grupo[i]!];
  return GRUPOS_ATRIBUTO.flatMap((g) => porGrupo.get(g)!.map((c) => c.valorId));
}

/**
 * Lo que se escribe en el formulario → columnas del valor, según el tipo del
 * atributo. Un número que no es número («220-240V~50/60Hz») se guarda en texto
 * en vez de perderse; «0,27» y «0.27» valen lo mismo.
 */
export function valorAColumnas(dataType: string, entrada: string | boolean | null) {
  const vacio = {
    value_text: null as string | null,
    value_number: null as number | null,
    value_boolean: null as boolean | null,
    value_json: null,
  };
  if (entrada === null) return vacio;
  if (dataType === "boolean") {
    if (typeof entrada === "boolean") return { ...vacio, value_boolean: entrada };
    const t = entrada.trim().toLowerCase();
    if (["sí", "si", "true", "1"].includes(t)) return { ...vacio, value_boolean: true };
    if (["no", "false", "0"].includes(t)) return { ...vacio, value_boolean: false };
    throw new Error("Escribe «Sí» o «No»");
  }
  const t = String(entrada).trim();
  if (!t) return vacio;
  if ((dataType === "number" || dataType === "dimension") && /^-?\d+([.,]\d+)?$/.test(t)) {
    return { ...vacio, value_number: Number(t.replace(",", ".")) };
  }
  return { ...vacio, value_text: t };
}

// =============================================================================
// Precio y stock
// =============================================================================

export interface FilaPlanPrecio {
  plan_type: string;
  is_active?: boolean | null;
  total_price_cents: number | null;
  total_price_individual_cents?: number | null;
  monthly_price_cents?: number | null;
  monthly_price_individual_cents?: number | null;
}

export function formatearEuros(cents: number): string {
  const entero = cents % 100 === 0;
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: entero ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** «Contado 1.290 €» y «desde 39 €/mes» (cuota más baja de renting/alquiler). */
export function resumenPrecio(planes: FilaPlanPrecio[]): {
  contadoCents: number | null;
  desdeMesCents: number | null;
} {
  const activos = planes.filter((p) => p.is_active !== false);
  const contado = activos.find((p) => p.plan_type === "cash");
  const contadoCents = contado
    ? (contado.total_price_individual_cents ?? contado.total_price_cents ?? null)
    : null;
  const cuotas = activos
    .filter((p) => p.plan_type !== "cash")
    .map((p) => p.monthly_price_individual_cents ?? p.monthly_price_cents ?? null)
    .filter((c): c is number => c != null && c > 0);
  return {
    contadoCents: contadoCents != null && contadoCents > 0 ? contadoCents : null,
    desdeMesCents: cuotas.length > 0 ? Math.min(...cuotas) : null,
  };
}

// =============================================================================
// Lista por categorías
// =============================================================================

export interface ProductoListaEmpresa {
  id: string;
  name: string;
  kind: string;
  category_id: string | null;
  internal_reference: string | null;
  supplier_reference: string | null;
  is_active: boolean;
  main_image_url: string | null;
  gama_id: string | null;
  rasgos_identificacion: string | null;
  tags: string[] | null;
  stock_managed?: boolean | null;
  show_in_calculator?: boolean | null;
  cash_price_cents: number | null;
}

export interface FiltrosListaEmpresa {
  cat: string;
  gama: string;
  q: string;
  tipo: string;
  estado: "" | "activos" | "inactivos";
  tag: string;
  sinPrecio: boolean;
  sinFoto: boolean;
  conActualizacion: boolean;
  vista: "" | "lista" | "rejilla" | "tabla";
}

export const TIPOS_PRODUCTO = ["equipment", "accessory", "consumable", "spare_part", "service"];

export function leerFiltrosEmpresa(
  sp: Record<string, string | string[] | undefined>,
): FiltrosListaEmpresa {
  const uno = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const estado = uno("estado");
  const vista = uno("vista");
  const tipo = uno("tipo");
  return {
    cat: uno("cat").slice(0, 80),
    gama: uno("gama").slice(0, 80),
    q: uno("q").slice(0, 80),
    tipo: TIPOS_PRODUCTO.includes(tipo) ? tipo : "",
    estado: estado === "activos" || estado === "inactivos" ? estado : "",
    tag: uno("tag").slice(0, 80),
    sinPrecio: uno("sinprecio") === "1",
    sinFoto: uno("sinfoto") === "1",
    conActualizacion: uno("actualizacion") === "1",
    vista: vista === "lista" || vista === "rejilla" || vista === "tabla" ? vista : "",
  };
}

export function filtrosEmpresaAParams(f: FiltrosListaEmpresa): Record<string, string | undefined> {
  return {
    cat: f.cat || undefined,
    gama: f.gama || undefined,
    q: f.q || undefined,
    tipo: f.tipo || undefined,
    estado: f.estado || undefined,
    tag: f.tag || undefined,
    sinprecio: f.sinPrecio ? "1" : undefined,
    sinfoto: f.sinFoto ? "1" : undefined,
    actualizacion: f.conActualizacion ? "1" : undefined,
    vista: f.vista || undefined,
  };
}

/** Sin categoría elegida, sin búsqueda y sin filtros: se enseña el kiosco. */
export function esKioscoEmpresa(f: FiltrosListaEmpresa): boolean {
  return (
    !f.cat &&
    !f.gama &&
    !f.q &&
    !f.tipo &&
    !f.estado &&
    !f.tag &&
    !f.sinPrecio &&
    !f.sinFoto &&
    !f.conActualizacion &&
    f.vista !== "tabla" &&
    f.vista !== "lista" &&
    f.vista !== "rejilla"
  );
}

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca en nombre, referencia interna, referencia de proveedor y rasgos. */
export function coincideBusqueda(p: ProductoListaEmpresa, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [p.name, p.internal_reference, p.supplier_reference, p.rasgos_identificacion]
    .filter(Boolean)
    .some((c) => sinTildes(String(c)).includes(t));
}

/**
 * Aplica los filtros (salvo la categoría y la gama, que decide quien llama).
 */
export function filtrarProductos(
  productos: ProductoListaEmpresa[],
  f: FiltrosListaEmpresa,
  desactualizados: Set<string>,
): ProductoListaEmpresa[] {
  return productos.filter((p) => {
    if (f.tipo && p.kind !== f.tipo) return false;
    if (f.estado === "activos" && !p.is_active) return false;
    if (f.estado === "inactivos" && p.is_active) return false;
    if (f.tag && !(p.tags ?? []).includes(f.tag)) return false;
    if (f.sinPrecio && p.cash_price_cents != null && p.cash_price_cents > 0) return false;
    if (f.sinFoto && p.main_image_url) return false;
    if (f.conActualizacion && !desactualizados.has(p.id)) return false;
    if (f.q && !coincideBusqueda(p, f.q)) return false;
    return true;
  });
}

/** Ids de cabeza de gama → nº de productos de la gama (cabeza incluida). */
export function contarGamas(productos: ProductoListaEmpresa[]): Map<string, number> {
  const ids = new Set(productos.map((p) => p.id));
  const m = new Map<string, number>();
  for (const p of productos) {
    if (p.gama_id && ids.has(p.gama_id)) m.set(p.gama_id, (m.get(p.gama_id) ?? 1) + 1);
  }
  return m;
}

/**
 * Pliega las gamas: deja las cabezas y los sueltos y quita las variantes cuya
 * cabeza esté en la misma lista (una variante nunca sale suelta junto a los
 * modelos; si su cabeza no está, sale ella).
 */
export function plegarGamas(productos: ProductoListaEmpresa[]): ProductoListaEmpresa[] {
  const ids = new Set(productos.map((p) => p.id));
  return productos.filter((p) => !(p.gama_id && ids.has(p.gama_id)));
}

export function ordenarPorNombre<T extends { name: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
}
