/**
 * Propuesta de captación (fase 4): lógica PURA, sin base de datos ni red.
 * La usan el generador del PDF, la página /p/[codigo], el latido de visitas y
 * el webhook (texto del wa.me con la referencia).
 *
 * Diseño: docs/DISENO_PROPUESTA_CAPTACION.md. Plan: §3.4 y §4.5.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { pickPrice } from "@/modules/proposals/pick-price";
import {
  contraste,
  derivarPaleta,
  hexAOklch,
  oklchAHex,
  oscurecerHasta,
  type PaletaFicha,
} from "@/modules/products/ficha/paleta";

// =============================================================================
// Código público
// =============================================================================

const ALFABETO_BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
export const LARGO_CODIGO = 12;
const RE_CODIGO = /^[a-z2-7]{12}$/;

/**
 * 12 caracteres en base32 minúscula = 60 bits (plan §3.4). `aleatorio` se
 * inyecta en los tests; en producción, randomBytes de node:crypto.
 */
export function generarCodigo(aleatorio: (n: number) => Uint8Array = (n) => new Uint8Array(randomBytes(n))): string {
  const bytes = aleatorio(8); // 64 bits; se usan 60.
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits >>= 4n;
  let out = "";
  for (let i = 0; i < LARGO_CODIGO; i++) {
    out = ALFABETO_BASE32[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

export function esCodigoValido(v: unknown): v is string {
  return typeof v === "string" && RE_CODIGO.test(v);
}

/** «k7m2q4abcdef» → «K7M2Q4» (lo que se dice por teléfono). */
export function referenciaDe(codigo: string): string {
  return codigo.slice(0, 6).toUpperCase();
}

/**
 * Busca «ref. K7M2Q4» en un texto libre (el mensaje prellenado del wa.me).
 * Devuelve la referencia en minúscula (prefijo del código) o null.
 */
export function referenciaEnTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = /\bref\.?\s*:?\s*([a-z2-7]{6})\b/i.exec(texto);
  return m ? m[1]!.toLowerCase() : null;
}

// =============================================================================
// Estado
// =============================================================================

export type EstadoPropuesta = "valida" | "caducada" | "revocada";

export function estadoPropuesta(
  p: { caduca_at: string; revocada_at: string | null },
  ahora: Date = new Date(),
): EstadoPropuesta {
  if (p.revocada_at) return "revocada";
  return new Date(p.caduca_at).getTime() <= ahora.getTime() ? "caducada" : "valida";
}

export const DIAS_VALIDEZ = 30;

export function caducidadDesde(desde: Date, dias = DIAS_VALIDEZ): Date {
  return new Date(desde.getTime() + dias * 86_400_000);
}

// =============================================================================
// Fechas (siempre en hora de Madrid)
// =============================================================================

const ZONA = "Europe/Madrid";
const MESES_CORTOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function partesMadrid(d: Date): { a: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return { a: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** «2026-11-27» (el día de Madrid; entra en el hash del visitante). */
export function diaMadrid(d: Date = new Date()): string {
  const p = partesMadrid(d);
  return `${p.a}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** «27-11-2026». */
export function fechaCorta(iso: string | Date): string {
  const p = partesMadrid(new Date(iso));
  return `${String(p.d).padStart(2, "0")}-${String(p.m).padStart(2, "0")}-${p.a}`;
}

/** «27 DIC 2026» (sello). */
export function fechaSello(iso: string | Date): string {
  const p = partesMadrid(new Date(iso));
  return `${p.d} ${MESES_CORTOS[p.m - 1]} ${p.a}`;
}

/** «27 de diciembre de 2026». */
export function fechaLarga(iso: string | Date): string {
  const p = partesMadrid(new Date(iso));
  return `${p.d} de ${MESES_LARGOS[p.m - 1]} de ${p.a}`;
}

// =============================================================================
// Líneas (lista blanca, plan §3.4)
// =============================================================================

export type TipoPrecio = "cash" | "renting" | "rental";
export const TIPOS_PRECIO: readonly TipoPrecio[] = ["rental", "renting", "cash"];
export const NOMBRE_TIPO_PRECIO: Record<TipoPrecio, string> = {
  rental: "alquiler",
  renting: "renting",
  cash: "compra",
};

export interface PrecioLinea {
  tipo: TipoPrecio;
  /** Cuota mensual (alquiler y renting). */
  mensual_cents: number | null;
  /** Total (compra). */
  total_cents: number | null;
  meses: number | null;
  /** true: base imponible, «+ IVA». false: IVA incluido. */
  mas_iva: boolean;
}

export interface MedidasLinea {
  ancho_mm: number | null;
  fondo_mm: number | null;
  alto_mm: number | null;
}

/**
 * Una partida de la propuesta, tal como se guarda en
 * captacion_propuestas.lineas. SOLO campos de la lista blanca: nunca
 * costes, márgenes, precios mínimos, fabricante ni referencias.
 */
export interface LineaPropuesta {
  product_id: string;
  nombre: string;
  descripcion: string | null;
  lema: string | null;
  imagen_url: string | null;
  medidas: MedidasLinea | null;
  garantia_meses: number | null;
  precios: PrecioLinea[];
}

/** Lo que se lee de `products` (y nada más). */
export interface ProductoLista {
  id: string;
  name: string;
  short_description: string | null;
  marketing_claim: string | null;
  main_image_url: string | null;
  dim_width_mm: number | null;
  dim_depth_mm: number | null;
  dim_height_mm: number | null;
  warranty_months_general: number | null;
}

/** Lo que se lee de `product_pricing_plans` (sin mínimos ni costes). */
export interface PlanLista {
  product_id: string;
  plan_type: TipoPrecio;
  duration_months: number | null;
  display_order: number | null;
  monthly_price_cents: number | null;
  total_price_cents: number | null;
  monthly_price_individual_cents: number | null;
  total_price_individual_cents: number | null;
  monthly_price_business_cents: number | null;
  total_price_business_cents: number | null;
}

export const COLUMNAS_PRODUCTO_LISTA =
  "id, name, short_description, marketing_claim, main_image_url, dim_width_mm, dim_depth_mm, dim_height_mm, warranty_months_general";
export const COLUMNAS_PLAN_LISTA =
  "product_id, plan_type, duration_months, display_order, monthly_price_cents, total_price_cents, monthly_price_individual_cents, total_price_individual_cents, monthly_price_business_cents, total_price_business_cents";

const texto = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
const positivo = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);

/**
 * Precio de un plan para una EMPRESA (el destinatario de captación siempre lo
 * es). Es la misma regla que la propuesta del CRM (`pickPrice` con
 * party_kind = company): `_business_cents` como base + IVA; si la empresa no
 * lo ha rellenado, el precio de particular con IVA incluido.
 */
export function precioEmpresa(plan: PlanLista): PrecioLinea | null {
  const p = pickPrice(
    {
      plan_type: plan.plan_type,
      duration_months: plan.duration_months,
      permanence_months: null,
      monthly_price_cents: plan.monthly_price_cents,
      total_price_cents: plan.total_price_cents ?? 0,
      monthly_price_individual_cents: plan.monthly_price_individual_cents,
      total_price_individual_cents: plan.total_price_individual_cents,
      monthly_price_business_cents: plan.monthly_price_business_cents,
      total_price_business_cents: plan.total_price_business_cents,
      min_authorized_cents: null,
      absolute_min_cents: null,
    },
    { party_kind: "company" },
  );
  if (plan.plan_type === "cash") {
    const total = positivo(p.total_cents);
    return total ? { tipo: "cash", mensual_cents: null, total_cents: total, meses: null, mas_iva: p.needs_iva } : null;
  }
  const mensual = positivo(p.monthly_cents);
  return mensual
    ? { tipo: plan.plan_type, mensual_cents: mensual, total_cents: null, meses: positivo(plan.duration_months), mas_iva: p.needs_iva }
    : null;
}

/**
 * Producto + planes → partida. `tipos` es lo que la empresa enseña
 * (captacion_conexiones.propuesta_precios); vacío = sin precios. Por cada
 * tipo, el primer plan activo (display_order).
 */
export function lineaDesdeProducto(prod: ProductoLista, planes: PlanLista[], tipos: readonly TipoPrecio[]): LineaPropuesta {
  const precios: PrecioLinea[] = [];
  for (const tipo of TIPOS_PRECIO) {
    if (!tipos.includes(tipo)) continue;
    const delTipo = planes
      .filter((x) => x.product_id === prod.id && x.plan_type === tipo)
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    for (const plan of delTipo) {
      const pr = precioEmpresa(plan);
      if (pr) {
        precios.push(pr);
        break;
      }
    }
  }
  const medidas: MedidasLinea = {
    ancho_mm: positivo(prod.dim_width_mm),
    fondo_mm: positivo(prod.dim_depth_mm),
    alto_mm: positivo(prod.dim_height_mm),
  };
  return {
    product_id: prod.id,
    nombre: texto(prod.name) ?? "Equipo",
    descripcion: texto(prod.short_description),
    lema: texto(prod.marketing_claim),
    imagen_url: texto(prod.main_image_url),
    medidas: medidas.ancho_mm || medidas.fondo_mm || medidas.alto_mm ? medidas : null,
    garantia_meses: positivo(prod.warranty_months_general),
    precios,
  };
}

/** Lee `lineas` de la base sin fiarse de su forma. */
export function leerLineas(v: unknown): LineaPropuesta[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => {
      const med = (x.medidas && typeof x.medidas === "object" ? x.medidas : null) as Record<string, unknown> | null;
      const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
      const str = (s: unknown) => (typeof s === "string" ? texto(s) : null);
      const precios = Array.isArray(x.precios)
        ? (x.precios as Array<Record<string, unknown>>)
            .filter((p) => p && (p.tipo === "cash" || p.tipo === "renting" || p.tipo === "rental"))
            .map((p) => ({
              tipo: p.tipo as TipoPrecio,
              mensual_cents: num(p.mensual_cents),
              total_cents: num(p.total_cents),
              meses: num(p.meses),
              mas_iva: p.mas_iva === true,
            }))
        : [];
      const medidas = med ? { ancho_mm: num(med.ancho_mm), fondo_mm: num(med.fondo_mm), alto_mm: num(med.alto_mm) } : null;
      return {
        product_id: typeof x.product_id === "string" ? x.product_id : "",
        nombre: str(x.nombre) ?? "Equipo",
        descripcion: str(x.descripcion),
        lema: str(x.lema),
        imagen_url: str(x.imagen_url),
        medidas: medidas && (medidas.ancho_mm || medidas.fondo_mm || medidas.alto_mm) ? medidas : null,
        garantia_meses: num(x.garantia_meses),
        precios,
      };
    });
}

export const MAX_EQUIPOS = 6;

// =============================================================================
// Formato de datos
// =============================================================================

function cm(mm: number): string {
  const v = Math.round(mm / 10 * 10) / 10; // una decimal
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
}

/** «26 × 45 × 41 cm» (ancho × fondo × alto); solo las cotas que haya. */
export function formatoMedidas(m: MedidasLinea | null): { valor: string; leyenda: string } | null {
  if (!m) return null;
  const partes: Array<[string, number | null]> = [
    ["ancho", m.ancho_mm],
    ["fondo", m.fondo_mm],
    ["alto", m.alto_mm],
  ];
  const hay = partes.filter((p): p is [string, number] => p[1] != null);
  if (hay.length === 0) return null;
  return { valor: `${hay.map((p) => cm(p[1])).join(" × ")} cm`, leyenda: hay.map((p) => p[0]).join(" × ") };
}

/** 24 → «2 años»; 12 → «1 año»; 18 → «18 meses». */
export function formatoGarantia(meses: number | null): string | null {
  if (!meses || meses <= 0) return null;
  if (meses % 12 === 0) return meses === 12 ? "1 año" : `${meses / 12} años`;
  return meses === 1 ? "1 mes" : `${meses} meses`;
}

/** 119000 → «1.190,00 €». Sin Intl para que no dependa del ICU del servidor. */
export function euros(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const entero = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${entero},${dec} €`;
}

/** Fila de precio: { rotulo: «alquiler», valor: «29,00 €/mes + IVA» }. */
export function formatoPrecio(p: PrecioLinea): { rotulo: string; valor: string } | null {
  const iva = p.mas_iva ? " + IVA" : ", IVA incluido";
  if (p.tipo === "cash") return p.total_cents ? { rotulo: "compra", valor: `${euros(p.total_cents)}${iva}` } : null;
  if (!p.mensual_cents) return null;
  const meses = p.tipo === "renting" && p.meses ? ` · ${p.meses} meses` : "";
  return { rotulo: NOMBRE_TIPO_PRECIO[p.tipo], valor: `${euros(p.mensual_cents)}/mes${iva}${meses}` };
}

/** Filas de la casilla de datos («Sin Dato, Sin Hueco»: ninguna vacía). */
export function filasDatos(l: LineaPropuesta, conPrecios: boolean): Array<{ rotulo: string; valor: string; leyenda?: string }> {
  const out: Array<{ rotulo: string; valor: string; leyenda?: string }> = [];
  const med = formatoMedidas(l.medidas);
  if (med) out.push({ rotulo: "medidas", valor: med.valor, leyenda: med.leyenda });
  const gar = formatoGarantia(l.garantia_meses);
  if (gar) out.push({ rotulo: "garantía", valor: gar });
  if (conPrecios) {
    for (const p of l.precios) {
      const f = formatoPrecio(p);
      if (f) out.push(f);
    }
  }
  return out;
}

/** ¿Alguna línea lleva de verdad un precio? («De la Fila que Falta».) */
export function hayPrecios(lineas: LineaPropuesta[], conPrecios: boolean): boolean {
  return conPrecios && lineas.some((l) => l.precios.some((p) => formatoPrecio(p) != null));
}

// =============================================================================
// Textos
// =============================================================================

export const MAX_CARTA = 280;
export const MAX_QUE_INCLUYE_LINEAS = 4;

const NUMEROS = ["", "el", "los dos", "los tres", "los cuatro", "los cinco", "los seis"];

/** Texto por defecto de la carta (§5.1 C), según cuántos equipos van. */
export function cartaPorDefecto(nEquipos: number): string {
  if (nEquipos <= 1) {
    return "Nos pedisteis que os contáramos más. Este es el equipo que solemos instalar en negocios como el vuestro. Miradlo con calma; si os encaja, os llamamos y lo vemos con números.";
  }
  const cuantos = NUMEROS[Math.min(nEquipos, 6)] ?? "los";
  return `Nos pedisteis que os contáramos más. Estos son ${cuantos} equipos que solemos instalar en negocios como el vuestro. Miradlos con calma; si alguno os encaja, os llamamos y lo vemos con números.`;
}

/** Carta de la campaña con {{negocio}} sustituido, o la de por defecto. Máx. 280. */
export function cartaFinal(textoCampana: string | null | undefined, nombreNegocio: string, nEquipos: number): string {
  const base = texto(textoCampana) ?? cartaPorDefecto(nEquipos);
  const t = base.replace(/\{\{\s*negocio\s*\}\}/gi, nombreNegocio);
  return t.length <= MAX_CARTA ? t : recortarPorFrase(t, MAX_CARTA);
}

/** «Qué incluye»: una línea por punto, sin la raya de delante, como mucho 4. */
export function lineasQueIncluye(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*[-–—•·*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_QUE_INCLUYE_LINEAS);
}

/** Corta por frase completa (nunca con puntos suspensivos a media palabra). */
export function recortarPorFrase(t: string, max: number): string {
  if (t.length <= max) return t;
  const frases = t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const f of frases) {
    if ((out + f).trim().length > max) break;
    out += f;
  }
  out = out.trim();
  if (out) return out;
  // Una sola frase más larga que el tope: por palabra completa, con punto.
  const palabras = t.slice(0, max).split(" ");
  palabras.pop();
  return `${palabras.join(" ").replace(/[,;:]$/, "")}.`;
}

export const TITULO_RELACION = (n: number) => (n === 1 ? "El equipo que os proponemos" : "Equipos que os proponemos");

export const NOTA_SIN_PRECIOS =
  "Los precios dependen de cuántos equipos necesitéis y de si preferís alquiler o compra. Os los damos por teléfono, sin compromiso.";

export const ACCION = "Que me llaméis";

/** Mensaje prellenado del botón «Que me llaméis» (§5.5). */
export function textoQueMeLlameis(nombreNegocio: string, ref: string): string {
  return `Hola, soy de ${nombreNegocio}. He visto la propuesta (ref. ${ref}) y quiero que me llaméis.`;
}

/** Mensaje de «Pedir una actualizada». En la revocada, sin nombre ni referencia. */
export function textoPedirActualizada(estado: "caducada" | "revocada", nombreNegocio: string, ref: string): string {
  if (estado === "revocada") return "Hola, quería una propuesta actualizada de vuestros equipos.";
  return `Hola, soy de ${nombreNegocio}. La propuesta (ref. ${ref}) ha caducado. ¿Me mandáis una actualizada?`;
}

/** https://wa.me/<E.164 sin +>?text=… (número de captación, no el principal). */
export function enlaceWaMe(numeroE164: string | null | undefined, mensaje: string): string | null {
  const digitos = (numeroE164 ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`;
}

/** Pie corto del mensaje `document` (≤ 1024 en Meta; aquí mucho menos). */
export function pieDocumento(urlPagina: string): string {
  return `Aquí tenéis la propuesta. También la podéis ver en el móvil: ${urlPagina}`;
}

// =============================================================================
// Texto para el PDF (WinAnsi)
// =============================================================================

/**
 * Lo que Helvetica/Courier estándar no pueden pintar se QUITA (emoji,
 * pictogramas), en lugar de convertirse en «?» (§6.6). Se conservan el
 * apóstrofo curvo (’), el punto volado (·), comillas y rayas, que sí están en
 * WinAnsi. Espacios raros → espacio normal.
 */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
export function limpiarTextoPdf(v: string | null | undefined): string {
  let out = "";
  for (const ch of String(v ?? "").normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a) out += "\n";
    else if (cp === 0x09 || cp === 0x0d || cp === 0xa0 || cp === 0x202f || (cp >= 0x2000 && cp <= 0x200a)) out += " ";
    else if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff) || WINANSI_EXTRA.has(cp)) out += ch;
    // Todo lo demás (emoji, selectores de variante, ZWJ…) se elimina.
  }
  return out.replace(/[ ]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/** «Propuesta Restaurante Ca'n Toni.pdf», sin caracteres que rompan un nombre de fichero. */
export function nombreFicheroPdf(nombreNegocio: string): string {
  const limpio = limpiarTextoPdf(nombreNegocio)
    .replace(/[\\/:*?"<>|\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `Propuesta ${limpio || "de equipos"}.pdf`;
}

// =============================================================================
// Visitas (sin cookies; plan §3.4 y §4.5)
// =============================================================================

/**
 * SHA-256 de IP + agente + día + sal. La IP no se guarda en ningún sitio.
 * Como el día entra en el hash, la misma persona al día siguiente es otra
 * fila (y eso es «vuelve otro día»).
 */
export function hashVisitante(ip: string, agente: string, dia: string, sal: string): string {
  return createHash("sha256").update(`${ip}\n${agente}\n${dia}\n${sal}`).digest("hex");
}

/** Sal del hash: la variable propia si existe; si no, derivada de un secreto del servidor. */
export function salDeVisitas(env: Record<string, string | undefined>): string {
  if (env.CAPTACION_SAL_VISITAS) return env.CAPTACION_SAL_VISITAS;
  const secreto = env.SUPABASE_SERVICE_ROLE_KEY ?? env.CRON_SECRET ?? "";
  return createHmac("sha256", secreto).update("captacion-visitas").digest("hex");
}

/**
 * Agentes que piden la URL sin que nadie la abra (vista previa de WhatsApp,
 * Facebook, antivirus, buscadores). No cuentan aunque ejecutaran el script.
 */
export function esAgenteAutomatico(agente: string | null | undefined): boolean {
  const a = (agente ?? "").toLowerCase();
  if (!a) return true;
  return /whatsapp|facebookexternalhit|facebot|meta-externalagent|bot\b|crawler|spider|preview|headless|curl|wget|python-requests|slackbot|telegrambot|skypeuripreview|bingpreview/.test(
    a,
  );
}

export function dispositivoDe(agente: string | null | undefined): "movil" | "escritorio" {
  return /mobile|android|iphone|ipad|ipod/i.test(agente ?? "") ? "movil" : "escritorio";
}

export interface Pulso {
  codigo: string;
  segundos: number;
  scroll: number;
}

/** Cuerpo del latido (JSON en texto plano, como lo manda sendBeacon). */
export function leerPulso(cuerpo: unknown): Pulso | null {
  let o: unknown = cuerpo;
  if (typeof cuerpo === "string") {
    if (cuerpo.length > 500) return null;
    try {
      o = JSON.parse(cuerpo);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (!esCodigoValido(r.c)) return null;
  const s = typeof r.s === "number" && Number.isFinite(r.s) ? Math.floor(r.s) : NaN;
  const y = typeof r.y === "number" && Number.isFinite(r.y) ? Math.round(r.y) : NaN;
  if (Number.isNaN(s) || Number.isNaN(y)) return null;
  return { codigo: r.c, segundos: Math.max(0, Math.min(s, 86_400)), scroll: Math.max(0, Math.min(y, 100)) };
}

// =============================================================================
// Paleta de la página (§4.1): papeles teñidos + tinta + el color de la marca
// =============================================================================

export interface PaletaPropuesta extends PaletaFicha {
  mesa: string;
  hoja: string;
  hojaDebajo: string;
  filete: string;
  /** El primario oscurecido hasta 4,5:1 contra el velo (el fondo más oscuro donde es texto). */
  trazo: string;
  /** Relleno del botón al pasar el ratón (6 % menos de L), si mantiene el contraste. */
  campoHover: string;
}

/**
 * Envuelve derivarPaleta() y VUELVE A MEDIR contra los papeles teñidos
 * («Del Contraste Calculado»): primarioTrazo se calculó contra blanco y sobre
 * la hoja teñida no llega a 4,5:1 con marcas claras. La ficha técnica (papel
 * blanco) sigue usando derivarPaleta() tal cual.
 */
export function derivarPaletaPropuesta(primarioEnt: string, acentoEnt?: string | null): PaletaPropuesta {
  const base = derivarPaleta(primarioEnt, acentoEnt);
  const p = hexAOklch(base.primario);
  const mesa = oklchAHex({ l: 0.925, c: Math.min(p.c, 0.014), h: p.h });
  const hoja = oklchAHex({ l: 0.985, c: Math.min(p.c, 0.006), h: p.h });
  const hojaDebajo = oklchAHex({ l: 0.955, c: Math.min(p.c, 0.01), h: p.h });
  const filete = oklchAHex({ l: 0.8, c: Math.min(p.c, 0.02), h: p.h });

  // Tinta suave: comprobada contra la mesa (el papel más oscuro que pisa).
  const tintaSuave = oscurecerHasta(base.tintaSuave, 4.5, mesa).hex;

  // Trazo: contra el velo; si hacen falta más de 25 pasos, en tinta.
  const t = oscurecerHasta(base.primario, 4.5, base.velo);
  let trazo = t.pasos > 25 ? base.tinta : t.hex;
  if (contraste(trazo, hoja) < 4.5) trazo = base.tinta;

  // Hover: −6 % de L; si el texto pierde el 4,5:1, el relleno no cambia.
  const c = hexAOklch(base.primarioCampo);
  const cand = oklchAHex({ l: Math.max(0, c.l - 0.06), c: c.c, h: c.h });
  const campoHover = contraste(base.sobreCampo, cand) >= 4.5 ? cand : base.primarioCampo;

  return { ...base, tintaSuave, mesa, hoja, hojaDebajo, filete, trazo, campoHover };
}
