/**
 * Modelo normalizado de la ficha técnica (plantillas «Tarifa», «Escaparate» y
 * «Placa»). Módulo PURO: convierte lo leído de la base en lo que se pinta, para
 * que el PDF (pdf-lib) y la maqueta HTML de configuración lean lo mismo.
 *
 * Reglas que se aplican aquí (docs/DISENO_FICHAS_Y_PRODUCTOS.md §B y §F):
 * - «Del Fabricante Mudo»: nunca el fabricante, ni el proveedor, ni su
 *   referencia; la referencia de cabecera solo si es propia de la empresa.
 * - «Sin Dato, Sin Hueco»: un bloque sin filas no existe.
 * - «De la Cota»: la letra del dibujo encabeza su fila.
 */

import type { CaracteristicaEmpresa } from "../productos-vista";
import { formatearNumeroEs } from "../valor-atributo";

export const PLANTILLAS_NUEVAS = ["tarifa", "escaparate", "placa"] as const;
export type PlantillaNueva = (typeof PLANTILLAS_NUEVAS)[number];
export type PlantillaFicha = PlantillaNueva | "standard" | "iagua";

export function esPlantillaNueva(v: unknown): v is PlantillaNueva {
  return typeof v === "string" && (PLANTILLAS_NUEVAS as readonly string[]).includes(v);
}

export const NOMBRE_PLANTILLA: Record<PlantillaFicha, string> = {
  tarifa: "Tarifa",
  escaparate: "Escaparate",
  placa: "Placa",
  standard: "Estándar",
  iagua: "IAGUA",
};

export type LetraCota = "a" | "b" | "c" | "d";

export interface FilaFicha {
  cota: LetraCota | null;
  etiqueta: string;
  valor: string;
  /** Unidad en su propia columna (vacía si el valor ya la lleva o no tiene). */
  unidad: string;
}

export interface BloqueFicha {
  clave: "fisicas" | "electricas" | "tecnicas" | "extra";
  titulo: string;
  filas: FilaFicha[];
}

export interface VentajaFicha {
  titulo: string;
  descripcion: string | null;
  iconoUrl: string | null;
}

export interface RecambioFicha {
  nombre: string;
  detalle: string | null;
  cantidad: number | null;
}

export interface EmpresaFicha {
  nombre: string;
  razonSocial: string | null;
  telefono: string | null;
  correo: string | null;
  web: string | null;
  localidad: string | null;
  logoUrl: string | null;
}

export interface FichaModelo {
  productoId: string;
  nombre: string;
  /** Referencia propia de la empresa (nunca la del proveedor). */
  referencia: string | null;
  rasgos: string[];
  descripcion: string | null;
  descripcionLarga: string | null;
  fotoUrl: string | null;
  medidasUrl: string | null;
  cotas: Partial<Record<LetraCota, number>>;
  /** Hay dibujo de medidas (imagen o, con las tres cotas, dibujo vectorial). */
  hayDibujo: boolean;
  bloques: BloqueFicha[];
  ventajas: VentajaFicha[];
  recambios: RecambioFicha[];
  empresa: EmpresaFicha;
  /** Fecha de revisión (última modificación del producto), «26-11-2026». */
  revision: string | null;
}

export interface OpcionesFicha {
  telefono: string | null;
  correo: string | null;
  web: string | null;
  mostrarRecambios: boolean;
  mostrarVentajas: boolean;
}

/** [decide] Por defecto se enseñan consumibles y ventajas (como la ficha de referencia). */
export const OPCIONES_POR_DEFECTO: OpcionesFicha = {
  telefono: null,
  correo: null,
  web: null,
  mostrarRecambios: true,
  mostrarVentajas: true,
};

export function leerOpcionesFicha(v: unknown): OpcionesFicha {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const txt = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 120) : null);
  return {
    telefono: txt(o.telefono),
    correo: txt(o.correo),
    web: txt(o.web),
    mostrarRecambios: o.mostrar_recambios !== false,
    mostrarVentajas: o.mostrar_ventajas !== false,
  };
}

// =============================================================================
// Secciones por producto (anulan lo de la empresa)
// =============================================================================

/** Secciones de la ficha que se pueden ocultar producto a producto. */
export const SECCIONES_FICHA = ["ventajas", "recambios", "medidas"] as const;
export type SeccionFicha = (typeof SECCIONES_FICHA)[number];

/**
 * Lo que el producto dice de cada sección: true / false fija; null = lo que
 * diga la empresa. Vive en products.datasheet_extra.ficha_secciones (jsonb que
 * ya existe), así no hace falta migración.
 */
export type SeccionesProducto = Record<SeccionFicha, boolean | null>;

export const CLAVE_SECCIONES = "ficha_secciones";

export function leerSeccionesProducto(extra: unknown): SeccionesProducto {
  const e = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const s = (e[CLAVE_SECCIONES] && typeof e[CLAVE_SECCIONES] === "object" ? e[CLAVE_SECCIONES] : {}) as Record<
    string,
    unknown
  >;
  const b = (x: unknown) => (typeof x === "boolean" ? x : null);
  return { ventajas: b(s.ventajas), recambios: b(s.recambios), medidas: b(s.medidas) };
}

/** Lo que sale de verdad: el producto manda; si no dice nada, la empresa (el dibujo, siempre sí). */
export function seccionesEfectivas(
  opciones: Pick<OpcionesFicha, "mostrarVentajas" | "mostrarRecambios">,
  producto: SeccionesProducto,
): Record<SeccionFicha, boolean> {
  return {
    ventajas: producto.ventajas ?? opciones.mostrarVentajas,
    recambios: producto.recambios ?? opciones.mostrarRecambios,
    medidas: producto.medidas ?? true,
  };
}

/**
 * datasheet_extra con las secciones cambiadas, SIN tocar el resto de claves
 * (features, why, ideal… de la ficha IAGUA). null borra la anulación.
 */
export function fusionarSeccionesProducto(
  extra: unknown,
  cambios: Partial<SeccionesProducto>,
): Record<string, unknown> {
  const base = (extra && typeof extra === "object" && !Array.isArray(extra) ? { ...(extra as object) } : {}) as Record<
    string,
    unknown
  >;
  const actuales = leerSeccionesProducto(base);
  const nuevas: Partial<Record<SeccionFicha, boolean>> = {};
  for (const k of SECCIONES_FICHA) {
    const v = k in cambios ? cambios[k] : actuales[k];
    if (typeof v === "boolean") nuevas[k] = v;
  }
  if (Object.keys(nuevas).length > 0) base[CLAVE_SECCIONES] = nuevas;
  else delete base[CLAVE_SECCIONES];
  return base;
}

// =============================================================================
// Texto
// =============================================================================

/**
 * Caracteres que Helvetica (WinAnsi) no tiene y que salen en los datos del
 * maestro. Lo demás lo cambia por «?» el saneador de dashstack.ts.
 */
export function textoImprimible(t: string): string {
  return t
    .replace(/Δ\s*/g, "salto ")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normal = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Palabras de la referencia que identifican (sin sufijos de 1-2 letras como «-S»). */
export function nucleoReferencia(ref: string): string {
  const partes = normal(ref).split(" ").filter(Boolean);
  const largas = partes.filter((p) => p.length > 2);
  return (largas.length > 0 ? largas : partes).join(" ");
}

/**
 * Referencia de la cabecera (respuesta 4 de Mario, 27-11): solo la interna
 * de la empresa, y solo si no coincide con la referencia del proveedor ni con
 * un nombre del proveedor. `nombresProveedor` son los nombres del maestro
 * (nombre, modelo, familia) y `refEnMaestro` dice si la referencia aparece
 * como nombre de algún producto del maestro (lo comprueba el cargador).
 */
export function referenciaImprimible(args: {
  interna: string | null;
  proveedor: string | null;
  nombresProveedor: string[];
  prohibidos: string[];
  refEnMaestro: boolean;
}): string | null {
  const ref = args.interna?.trim();
  if (!ref) return null;
  if (args.refEnMaestro) return null;
  const n = normal(ref);
  const nucleo = nucleoReferencia(ref);
  if (args.proveedor && normal(args.proveedor) === n) return null;
  for (const nombre of [...args.nombresProveedor, ...args.prohibidos]) {
    const m = normal(nombre);
    if (!m) continue;
    if (m === n || m.includes(nucleo) || nucleo.includes(m)) return null;
  }
  return ref;
}

/**
 * Quita de un texto los nombres del fabricante o del modelo del proveedor
 * («Dispensador de Sobremesa Blue Mountain» → «Dispensador de Sobremesa»),
 * salvo que formen parte del nombre que la empresa le ha puesto al producto.
 */
export function sinProveedor(texto: string | null, prohibidos: string[], nombreProducto: string): string | null {
  if (!texto) return null;
  let t = texto;
  const nombreN = normal(nombreProducto);
  for (const p of prohibidos) {
    const limpio = p.trim();
    if (limpio.length < 3) continue;
    if (nombreN.includes(normal(limpio))) continue;
    const re = new RegExp(`\\b${limpio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "gi");
    t = t.replace(re, " ");
  }
  t = t
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:·-]+|[\s,;:·-]+$/g, "")
    .trim();
  return t || null;
}

/** ¿Nombra al fabricante o al proveedor? (para descartar una fila entera). */
export function nombraFabricante(texto: string, fabricantes: string[]): boolean {
  const n = ` ${normal(texto)} `;
  return fabricantes.some((f) => {
    const m = normal(f);
    return m.length >= 3 && n.includes(` ${m} `);
  });
}

// =============================================================================
// Características → bloques
// =============================================================================

const TITULO_BLOQUE: Record<BloqueFicha["clave"], string> = {
  fisicas: "Características físicas",
  electricas: "Características eléctricas",
  tecnicas: "Características técnicas",
  extra: "Características extra",
};
const ORDEN_BLOQUES: BloqueFicha["clave"][] = ["fisicas", "electricas", "tecnicas", "extra"];

const RE_MIN_MAX = /^(.*?)\s+(m[ií]n(?:ima|imo)?|m[aá]x(?:ima|imo)?)\.?$/i;
const RE_COTA = /\s*\(([a-d])\)\s*$/i;

function crudo(c: CaracteristicaEmpresa): string | null {
  if (c.valorBooleano != null) return c.valorBooleano ? "Sí" : "No";
  if (c.valorNumero != null && Number.isFinite(Number(c.valorNumero)))
    return formatearNumeroEs(Number(c.valorNumero));
  const t = c.valorTexto?.trim();
  return t ? t : null;
}

function unidadDe(c: CaracteristicaEmpresa, valor: string): string {
  if (c.valorBooleano != null) return "";
  const u = c.unidad?.trim() ?? "";
  if (!u) return "";
  return valor.toLowerCase().endsWith(u.toLowerCase()) ? "" : u;
}

function grupoDe(c: CaracteristicaEmpresa): BloqueFicha["clave"] {
  const g = c.grupo;
  return g === "fisicas" || g === "electricas" || g === "tecnicas" || g === "extra" ? g : "tecnicas";
}

export interface MedidasProducto {
  anchoMm: number | null;
  altoMm: number | null;
  fondoMm: number | null;
  pesoG: number | null;
}

/**
 * Bloques de la ficha: cuatro grupos en orden fijo, pares mín./máx. unidos
 * («70–75 ºC»), y las medidas y el peso encabezando «físicas». Con
 * `conLetras`, las cotas llevan su letra (a ancho, b alto, c fondo y la que
 * traiga el nombre del atributo, «Altura de dispensación (d)»).
 */
export function bloquesDeFicha(
  caracteristicas: CaracteristicaEmpresa[],
  medidas: MedidasProducto,
  opciones: { conLetras: boolean; fabricantes: string[]; limpiar: (t: string) => string | null },
): BloqueFicha[] {
  const visibles = caracteristicas.filter((c) => c.visible).sort((a, b) => a.orden - b.orden);
  const porGrupo = new Map<BloqueFicha["clave"], CaracteristicaEmpresa[]>();
  for (const c of visibles) {
    const g = grupoDe(c);
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g)!.push(c);
  }

  const bloques: BloqueFicha[] = [];
  for (const clave of ORDEN_BLOQUES) {
    const lista = porGrupo.get(clave) ?? [];
    const filas: FilaFicha[] = [];
    if (clave === "fisicas") {
      const mm = (v: number | null) => (v != null && v > 0 ? v : null);
      const dims: Array<[LetraCota, string, number | null]> = [
        ["a", "Ancho", mm(medidas.anchoMm)],
        ["b", "Alto", mm(medidas.altoMm)],
        ["c", "Fondo", mm(medidas.fondoMm)],
      ];
      for (const [letra, etiqueta, v] of dims) {
        if (v == null) continue;
        filas.push({ cota: opciones.conLetras ? letra : null, etiqueta, valor: formatearNumeroEs(v), unidad: "mm" });
      }
      if (medidas.pesoG != null && medidas.pesoG > 0) {
        filas.push({
          cota: null,
          etiqueta: "Peso",
          valor: formatearNumeroEs(Math.round((medidas.pesoG / 1000) * 100) / 100),
          unidad: "kg",
        });
      }
    }

    // Emparejar mínimo y máximo por nombre base + unidad.
    const pares = new Map<string, { min?: CaracteristicaEmpresa; max?: CaracteristicaEmpresa }>();
    for (const c of lista) {
      const m = c.nombre.match(RE_MIN_MAX);
      if (!m) continue;
      const k = `${(m[1] ?? "").trim().toLowerCase()}|${c.unidad ?? ""}`;
      const p = pares.get(k) ?? {};
      if (/^m[ií]n/i.test(m[2] ?? "")) p.min = c;
      else p.max = c;
      pares.set(k, p);
    }
    const hechos = new Set<string>();
    for (const c of lista) {
      if (hechos.has(c.valorId)) continue;
      const m = c.nombre.match(RE_MIN_MAX);
      const k = m ? `${(m[1] ?? "").trim().toLowerCase()}|${c.unidad ?? ""}` : null;
      const par = k ? pares.get(k) : undefined;
      let etiqueta = c.nombre;
      let valor: string | null;
      let unidad: string;
      if (m && par?.min && par?.max) {
        hechos.add(par.min.valorId);
        hechos.add(par.max.valorId);
        const vMin = crudo(par.min);
        const vMax = crudo(par.max);
        if (vMin == null && vMax == null) continue;
        valor = vMin != null && vMax != null ? (vMin === vMax ? vMin : `${vMin}–${vMax}`) : (vMin ?? vMax)!;
        etiqueta = (m[1] ?? "").trim();
        unidad = unidadDe(c, valor);
      } else {
        hechos.add(c.valorId);
        valor = crudo(c);
        if (valor == null) continue;
        unidad = unidadDe(c, valor);
      }
      let cota: LetraCota | null = null;
      const mc = etiqueta.match(RE_COTA);
      if (mc) {
        etiqueta = etiqueta.replace(RE_COTA, "").trim();
        cota = opciones.conLetras ? (mc[1]!.toLowerCase() as LetraCota) : null;
      }
      if (nombraFabricante(valor, opciones.fabricantes) || nombraFabricante(etiqueta, opciones.fabricantes)) continue;
      const valorLimpio = opciones.limpiar(valor);
      if (!valorLimpio) continue;
      filas.push({
        cota,
        etiqueta: textoImprimible(etiqueta),
        valor: textoImprimible(valorLimpio),
        unidad: textoImprimible(unidad),
      });
    }
    if (filas.length > 0) bloques.push({ clave, titulo: TITULO_BLOQUE[clave], filas });
  }
  return bloques;
}

/** Cotas para el dibujo vectorial (mm). La «d» sale del atributo que la nombra. */
export function cotasDeFicha(
  medidas: MedidasProducto,
  caracteristicas: CaracteristicaEmpresa[],
): Partial<Record<LetraCota, number>> {
  const out: Partial<Record<LetraCota, number>> = {};
  if (medidas.anchoMm && medidas.anchoMm > 0) out.a = medidas.anchoMm;
  if (medidas.altoMm && medidas.altoMm > 0) out.b = medidas.altoMm;
  if (medidas.fondoMm && medidas.fondoMm > 0) out.c = medidas.fondoMm;
  for (const c of caracteristicas) {
    if (!c.visible) continue;
    const m = c.nombre.match(RE_COTA);
    if (m && m[1]!.toLowerCase() === "d" && c.valorNumero != null) out.d = Number(c.valorNumero);
  }
  return out;
}

/** «Sobremesa · Ósmosis inversa · c/Bomba» → ["Sobremesa", "Ósmosis inversa", "c/Bomba"]. */
export function rasgosDe(texto: string | null): string[] {
  if (!texto) return [];
  return texto
    .split(/[·|]/)
    .map((s) => textoImprimible(s))
    .filter(Boolean)
    .slice(0, 6);
}

/** «620952598» → «620 95 25 98»; «+34620952598» → «+34 620 95 25 98». Lo demás, tal cual. */
export function formatearTelefono(t: string | null | undefined): string | null {
  if (!t?.trim()) return null;
  const limpio = t.replace(/[\s.-]/g, "");
  const m = /^(\+34|0034)?([6789]\d{8})$/.exec(limpio);
  if (!m) return t.trim();
  const n = m[2]!;
  const cuerpo = `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  return m[1] ? `+34 ${cuerpo}` : cuerpo;
}

/** «2026-11-26T13:37:55Z» → «26-11-2026». */
export function fechaRevision(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}
