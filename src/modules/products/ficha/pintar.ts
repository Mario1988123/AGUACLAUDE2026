/**
 * Pinta la ficha técnica nueva con pdf-lib: una hoja A4 con el esqueleto de
 * la ficha de referencia (logo arriba, foto y medidas a la izquierda, datos
 * en grupos a la derecha, pie con los datos de la empresa) y tres acabados:
 *
 * - «Tarifa»: papel blanco y línea fina; la foto sobre un panel pálido.
 * - «Escaparate»: franja de color arriba; el equipo pisa el borde.
 * - «Placa»: compacta y en rejilla, para imprimir en blanco y negro.
 *
 * No lee la base de datos: recibe el modelo (modelo.ts), la paleta
 * (paleta.ts) y las imágenes ya convertidas (imagenes.ts). Todo texto se mide
 * antes de pintarlo; la fila encoge de 6,8 a 4,6 mm para caber en una hoja
 * («De la Hoja Única») y solo entonces salta a la segunda.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { withSanitizer } from "@/shared/lib/pdf/dashstack";
import type { BloqueFicha, FichaModelo, FilaFicha, PlantillaNueva, RecambioFicha } from "./modelo";
import type { PaletaFicha } from "./paleta";
import { incrustar, type ImagenLista } from "./imagenes";

// =============================================================================
// Medidas y utilidades
// =============================================================================

const MM = 72 / 25.4;
const ANCHO = 210;
const ALTO = 297;
const MARGEN = 12;
const UTIL = ANCHO - 2 * MARGEN; // 186
const PIE_Y = 274; // filete del pie (mm desde arriba)

const FILA_MAX = 6.8;
/** Holgura para comparar alturas (errores de coma flotante). */
const EPS = 0.05;
const FILA_MIN = 4.6;

export interface ImagenesFicha {
  logo: ImagenLista | null;
  foto: ImagenLista | null;
  medidas: ImagenLista | null;
  /** Mismo orden que modelo.ventajas; null = sin icono (se pinta un rombo). */
  iconos: Array<ImagenLista | null>;
}

interface Tintas {
  papel: RGB;
  tinta: RGB;
  tintaSuave: RGB;
  velo: RGB;
  linea: RGB;
  campo: RGB;
  sobreCampo: RGB;
  trazo: RGB;
  acentoTexto: RGB;
  acentoMarca: RGB;
}

function hexRgb(hex: string): RGB {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}

function mezcla(a: string, b: string, t: number): RGB {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) / 255);
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16) / 255);
  return rgb(...(ca.map((x, i) => x * (1 - t) + cb[i]! * t) as [number, number, number]));
}

function tintasDe(p: PaletaFicha): Tintas {
  return {
    papel: hexRgb(p.papel),
    tinta: hexRgb(p.tinta),
    tintaSuave: hexRgb(p.tintaSuave),
    velo: hexRgb(p.velo),
    linea: mezcla(p.tinta, p.papel, 0.84),
    campo: hexRgb(p.primarioCampo),
    sobreCampo: hexRgb(p.sobreCampo),
    trazo: hexRgb(p.primarioTrazo),
    acentoTexto: hexRgb(p.acentoTexto),
    acentoMarca: hexRgb(p.acentoMarca),
  };
}

interface Fuentes {
  f: PDFFont;
  b: PDFFont;
  m: PDFFont;
  mb: PDFFont;
}

/** y en puntos de pdf-lib a partir de mm medidos desde arriba. */
const Y = (mmDesdeArriba: number) => (ALTO - mmDesdeArriba) * MM;
const X = (mm: number) => mm * MM;

function ancho(font: PDFFont, t: string, size: number): number {
  return font.widthOfTextAtSize(t, size) / MM; // en mm
}

/** Recorta con «…» hasta caber en `max` mm. */
function ajustar(font: PDFFont, t: string, size: number, max: number): string {
  if (ancho(font, t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && ancho(font, `${s}…`, size) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function envolver(font: PDFFont, t: string, size: number, max: number): string[] {
  const out: string[] = [];
  for (const parrafo of t.split(/\n+/)) {
    let linea = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (ancho(font, prueba, size) <= max) linea = prueba;
      else {
        if (linea) out.push(linea);
        linea = ancho(font, palabra, size) > max ? ajustar(font, palabra, size, max) : palabra;
      }
    }
    if (linea) out.push(linea);
  }
  return out;
}

type Alinear = "izq" | "centro" | "der";

function texto(
  page: PDFPage,
  t: string,
  x: number,
  yBase: number,
  size: number,
  font: PDFFont,
  color: RGB,
  alinear: Alinear = "izq",
  espaciado = 0,
) {
  if (!t) return;
  const w = ancho(font, t, size) + (espaciado * Math.max(0, t.length - 1)) / MM;
  const x0 = alinear === "izq" ? x : alinear === "centro" ? x - w / 2 : x - w;
  if (!espaciado) {
    page.drawText(t, { x: X(x0), y: Y(yBase), size, font, color });
    return;
  }
  // pdf-lib 1.17 no tiene espaciado entre letras: se pinta letra a letra.
  let cx = X(x0);
  for (const ch of t) {
    page.drawText(ch, { x: cx, y: Y(yBase), size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + espaciado;
  }
}

function rect(page: PDFPage, x: number, y: number, w: number, h: number, color?: RGB, borde?: { color: RGB; grosor: number }) {
  page.drawRectangle({
    x: X(x),
    y: Y(y + h),
    width: w * MM,
    height: h * MM,
    color,
    borderColor: borde?.color,
    borderWidth: borde?.grosor,
  });
}

function linea(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color: RGB, grosor: number) {
  page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, color, thickness: grosor });
}

/** Rectángulo con radios por esquina (mm): [arriba-izq, arriba-der, abajo-der, abajo-izq]. */
function rectRedondeado(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  radios: [number, number, number, number],
  color?: RGB,
  borde?: { color: RGB; grosor: number },
) {
  const [tl, tr, br, bl] = radios.map((r) => r * MM) as [number, number, number, number];
  const W = w * MM;
  const H = h * MM;
  const d = [
    `M ${tl} 0`,
    `L ${W - tr} 0`,
    tr ? `Q ${W} 0 ${W} ${tr}` : "",
    `L ${W} ${H - br}`,
    br ? `Q ${W} ${H} ${W - br} ${H}` : "",
    `L ${bl} ${H}`,
    bl ? `Q 0 ${H} 0 ${H - bl}` : "",
    `L 0 ${tl}`,
    tl ? `Q 0 0 ${tl} 0` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
  page.drawSvgPath(d, {
    x: X(x),
    y: Y(y),
    color,
    borderColor: borde?.color,
    borderWidth: borde?.grosor,
  });
}

/** Imagen ajustada («contain») dentro de una caja; devuelve la caja usada. */
function imagenEnCaja(
  page: PDFPage,
  img: PDFImage,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: "arriba" | "centro" | "abajo" = "centro",
  horizontal: "izq" | "centro" = "centro",
) {
  const r = img.width / img.height;
  let dw = w;
  let dh = w / r;
  if (dh > h) {
    dh = h;
    dw = h * r;
  }
  const dx = horizontal === "izq" ? x : x + (w - dw) / 2;
  const dy = vertical === "arriba" ? y : vertical === "abajo" ? y + h - dh : y + (h - dh) / 2;
  page.drawImage(img, { x: X(dx), y: Y(dy + dh), width: dw * MM, height: dh * MM });
  return { x: dx, y: dy, w: dw, h: dh };
}

/** Rombo pequeño (ventaja sin icono). */
function rombo(page: PDFPage, cx: number, cy: number, r: number, color: RGB) {
  const R = r * MM;
  page.drawSvgPath(`M 0 ${-R} L ${R} 0 L 0 ${R} L ${-R} 0 Z`, { x: X(cx), y: Y(cy), color });
}

function flecha(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color: RGB) {
  linea(page, x1, y1, x2, y2, color, 0.5);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a = 1.3;
  for (const [px, py, s] of [
    [x1, y1, 1],
    [x2, y2, -1],
  ] as const) {
    for (const da of [0.45, -0.45]) {
      linea(page, px, py, px + s * a * Math.cos(ang + da), py + s * a * Math.sin(ang + da), color, 0.5);
    }
  }
}

/**
 * Dibujo de medidas vectorial cuando no hay plano pero sí las tres cotas:
 * alzado (a × b) y perfil (c × b) con sus letras.
 */
function dibujarCotas(page: PDFPage, cotas: FichaModelo["cotas"], x: number, y: number, w: number, h: number, t: Tintas, fb: PDFFont) {
  const a = cotas.a ?? 0;
  const b = cotas.b ?? 0;
  const c = cotas.c ?? 0;
  if (!a || !b || !c) return;
  const hueco = 10;
  const margenLetras = 7;
  const escala = Math.min((w - hueco - 2 * margenLetras) / (a + c), (h - 2 * margenLetras) / b);
  const wa = a * escala;
  const wc = c * escala;
  const hb = b * escala;
  const totalW = wa + hueco + wc + margenLetras;
  const x0 = x + (w - totalW) / 2;
  const y0 = y + (h - margenLetras - hb) / 2;
  // Alzado
  rectRedondeado(page, x0, y0, wa, hb, [1.2, 1.2, 0.6, 0.6], undefined, { color: t.tinta, grosor: 0.8 });
  linea(page, x0 + wa * 0.12, y0 + hb * 0.62, x0 + wa * 0.88, y0 + hb * 0.62, t.tinta, 0.4);
  // Perfil
  const xs = x0 + wa + hueco;
  rectRedondeado(page, xs, y0, wc, hb, [1.2, 1.2, 0.6, 0.6], undefined, { color: t.tinta, grosor: 0.8 });
  // Cotas
  const yc = y0 + hb + 3.5;
  flecha(page, x0, yc, x0 + wa, yc, t.tintaSuave);
  texto(page, "a", x0 + wa / 2, yc + 4, 9, fb, t.acentoMarca, "centro");
  flecha(page, xs, yc, xs + wc, yc, t.tintaSuave);
  texto(page, "c", xs + wc / 2, yc + 4, 9, fb, t.acentoMarca, "centro");
  const xb = xs + wc + 3.5;
  flecha(page, xb, y0, xb, y0 + hb, t.tintaSuave);
  texto(page, "b", xb + 1.6, y0 + hb / 2 + 1.2, 9, fb, t.acentoMarca);
}

// =============================================================================
// Pie y cabeceras comunes
// =============================================================================

function lineaContacto(m: FichaModelo, conTelefono = true): string {
  const e = m.empresa;
  return [e.razonSocial ?? e.nombre, conTelefono ? e.telefono : null, e.correo, e.web, e.localidad]
    .filter((x): x is string => !!x && !!x.trim())
    .join("  ·  ");
}

const AVISO = "Datos técnicos sujetos a cambios sin previo aviso.";

function logoOEmpresa(page: PDFPage, logo: PDFImage | null, m: FichaModelo, x: number, y: number, w: number, h: number, fb: PDFFont, color: RGB) {
  if (logo) return imagenEnCaja(page, logo, x, y, w, h, "centro", "izq");
  const size = Math.min(14, h * 2);
  texto(page, ajustar(fb, m.empresa.nombre, size, w), x, y + h / 2 + size * 0.13, size, fb, color);
  return { x, y, w, h };
}

/** Pie de «Tarifa» y de la hoja 2: filete, logo pequeño, contacto, revisión y aviso. */
function pieLinea(page: PDFPage, m: FichaModelo, logo: PDFImage | null, t: Tintas, fu: Fuentes, numero?: string) {
  linea(page, MARGEN, PIE_Y, ANCHO - MARGEN, PIE_Y, t.linea, 0.6);
  let x = MARGEN;
  if (logo) {
    const caja = imagenEnCaja(page, logo, MARGEN, PIE_Y + 3.5, 26, 8, "centro", "izq");
    x = caja.x + caja.w + 4;
  }
  const max = ANCHO - MARGEN - x - 38;
  const lineas = envolver(fu.f, lineaContacto(m), 7, max).slice(0, 2);
  lineas.forEach((l, i) => texto(page, l, x, PIE_Y + 6.5 + i * 3.6, 7, fu.f, t.tinta));
  const der = ANCHO - MARGEN;
  if (m.revision) texto(page, `Rev. ${m.revision}${numero ? `  ·  ${numero}` : ""}`, der, PIE_Y + 6.5, 6.5, fu.f, t.tintaSuave, "der");
  texto(page, AVISO, ANCHO / 2, ALTO - 7, 6, fu.f, t.tintaSuave, "centro");
}

// =============================================================================
// Bloques de datos (Tarifa y Escaparate)
// =============================================================================

interface Region {
  x: number;
  w: number;
  y: number; // cursor
  fin: number; // límite inferior (mm)
}

interface EstiloFilas {
  tituloAlto: number;
  pintarTitulo: (page: PDFPage, titulo: string, r: Region) => void;
}

function medidasFila(filaH: number) {
  // De 6,8 mm / 8,5 pt a 4,6 mm / 7 pt.
  const t = (filaH - FILA_MIN) / (FILA_MAX - FILA_MIN);
  return { size: 7 + 1.5 * Math.max(0, Math.min(1, t)) };
}

function pintarFila(page: PDFPage, f: FilaFicha, r: Region, filaH: number, conLetras: boolean, t: Tintas, fu: Fuentes) {
  const { size } = medidasFila(filaH);
  const base = r.y + filaH / 2 + size * 0.125;
  const xLetra = r.x;
  const xEtiqueta = r.x + (conLetras ? 4.5 : 0);
  const wValor = Math.min(30, r.w * 0.3);
  const wUnidad = Math.min(15, r.w * 0.15);
  const xUnidad = r.x + r.w - wUnidad;
  const cValor = xUnidad - 1.5 - wValor / 2;
  const wEtiqueta = cValor - wValor / 2 - xEtiqueta - 1;
  if (f.cota) texto(page, f.cota, xLetra + 0.3, base, size + 0.5, fu.b, t.acentoMarca);
  texto(page, ajustar(fu.f, f.etiqueta, size, wEtiqueta), xEtiqueta, base, size, fu.f, t.tinta);
  if (ancho(fu.b, f.valor, size) <= wValor) {
    texto(page, f.valor, cValor, base, size, fu.b, t.tinta, "centro");
    if (f.unidad) texto(page, ajustar(fu.f, f.unidad, size, wUnidad), xUnidad, base, size, fu.f, t.tintaSuave);
  } else {
    // El valor no cabe en su columna: ocupa también la de la unidad.
    const v = f.unidad ? `${f.valor} ${f.unidad}` : f.valor;
    const espacio = r.x + r.w - (cValor - wValor / 2);
    let s = size;
    while (s > 6 && ancho(fu.b, v, s) > espacio) s -= 0.25;
    texto(page, ajustar(fu.b, v, s, espacio), r.x + r.w, base, s, fu.b, t.tinta, "der");
  }
  linea(page, r.x, r.y + filaH, r.x + r.w, r.y + filaH, t.linea, 0.35);
  r.y += filaH;
}

function altoRecambios(n: number, filaH: number, tituloAlto: number) {
  return n > 0 ? tituloAlto + n * filaH : 0;
}

function pintarRecambio(page: PDFPage, rc: RecambioFicha, r: Region, filaH: number, t: Tintas, fu: Fuentes) {
  const { size } = medidasFila(filaH);
  const base = r.y + filaH / 2 + size * 0.125;
  const cant = rc.cantidad ? `${rc.cantidad} ud.` : "";
  const wCant = 12;
  const wDetalle = rc.detalle ? Math.min(32, ancho(fu.f, rc.detalle, size - 0.5) + 2) : 0;
  texto(page, ajustar(fu.f, rc.nombre, size, r.w - wCant - wDetalle - 2), r.x, base, size, fu.f, t.tinta);
  if (rc.detalle) texto(page, rc.detalle, r.x + r.w - wCant - 1, base, size - 0.5, fu.f, t.tintaSuave, "der");
  if (cant) texto(page, cant, r.x + r.w, base, size, fu.b, t.tinta, "der");
  linea(page, r.x, r.y + filaH, r.x + r.w, r.y + filaH, t.linea, 0.35);
  r.y += filaH;
}

/** Elige la altura de fila para que todo quepa (o lo más cerca, sin bajar de 4,6). */
function elegirFila(nFilas: number, nTitulos: number, tituloAlto: number, disponible: number): number {
  if (nFilas === 0) return FILA_MAX;
  const h = (disponible - nTitulos * tituloAlto) / nFilas;
  return Math.max(FILA_MIN, Math.min(FILA_MAX, Math.floor(h * 10) / 10));
}

// =============================================================================
// Documento
// =============================================================================

interface Documento {
  pdf: PDFDocument;
  fu: Fuentes;
  t: Tintas;
  logo: PDFImage | null;
  foto: PDFImage | null;
  medidas: PDFImage | null;
  fotoTransparente: boolean;
  iconos: Array<PDFImage | null>;
}

async function prepararDocumento(m: FichaModelo, paleta: PaletaFicha, imgs: ImagenesFicha): Promise<Documento> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Ficha técnica · ${m.nombre}`);
  pdf.setAuthor(m.empresa.nombre);
  pdf.setCreator(m.empresa.nombre);
  pdf.setProducer(m.empresa.nombre);
  pdf.setSubject("Ficha técnica");
  pdf.setLanguage("es-ES");
  const fu: Fuentes = {
    f: withSanitizer(await pdf.embedFont(StandardFonts.Helvetica)),
    b: withSanitizer(await pdf.embedFont(StandardFonts.HelveticaBold)),
    m: withSanitizer(await pdf.embedFont(StandardFonts.Courier)),
    mb: withSanitizer(await pdf.embedFont(StandardFonts.CourierBold)),
  };
  return {
    pdf,
    fu,
    t: tintasDe(paleta),
    logo: await incrustar(pdf, imgs.logo),
    foto: await incrustar(pdf, imgs.foto),
    medidas: await incrustar(pdf, imgs.medidas),
    fotoTransparente: imgs.foto?.formato === "png",
    iconos: await Promise.all(imgs.iconos.map((i) => incrustar(pdf, i))),
  };
}

/** Cabecera de la hoja 2 (las tres plantillas): logo, nombre y filete. */
function cabeceraHoja2(page: PDFPage, m: FichaModelo, d: Documento) {
  logoOEmpresa(page, d.logo, m, MARGEN, 10, 40, 11, d.fu.b, d.t.trazo);
  texto(page, ajustar(d.fu.b, `${m.nombre} (continuación)`, 10, 120), ANCHO - MARGEN, 17.5, 10, d.fu.b, d.t.trazo, "der");
  linea(page, MARGEN, 25, ANCHO - MARGEN, 25, d.t.linea, 0.6);
}

/**
 * Coloca los bloques y los recambios en las regiones dadas; lo que no quepa
 * va a la hoja 2 (a todo el ancho). Un grupo que no cabe entero empieza en la
 * región siguiente si allí sí cabe; si no, se parte con «(continuación)».
 */
function fluir(
  d: Documento,
  m: FichaModelo,
  paginas: PDFPage[],
  regiones: Region[],
  estilo: EstiloFilas,
  filaH: number,
  recambios: RecambioFicha[],
  pie: (page: PDFPage, numero?: string) => void,
) {
  const conLetras = m.bloques.some((b) => b.filas.some((f) => f.cota));
  let ri = 0;
  // Las regiones iniciales son todas de la hoja 1.
  const indicePagina: number[] = regiones.map(() => 0);
  const nuevaRegion = () => {
    ri++;
    if (ri >= regiones.length) {
      const p = d.pdf.addPage([ANCHO * MM, ALTO * MM]);
      paginas.push(p);
      cabeceraHoja2(p, m, d);
      pie(p, `Hoja ${paginas.length}`);
      regiones.push({ x: MARGEN, w: UTIL, y: 31, fin: PIE_Y - 4 });
      indicePagina.push(paginas.length - 1);
    }
  };
  const region = () => regiones[ri]!;
  const pagina = () => paginas[indicePagina[ri] ?? 0]!;

  const bloques: Array<{ titulo: string; filas: Array<{ tipo: "fila"; f: FilaFicha } | { tipo: "rec"; r: RecambioFicha }> }> =
    m.bloques.map((b: BloqueFicha) => ({ titulo: b.titulo, filas: b.filas.map((f) => ({ tipo: "fila" as const, f })) }));
  if (recambios.length > 0)
    bloques.push({ titulo: "Consumibles y recambios", filas: recambios.map((r) => ({ tipo: "rec" as const, r })) });

  for (const b of bloques) {
    const altoTotal = estilo.tituloAlto + b.filas.length * filaH - EPS;
    // Si no cabe entero aquí pero sí en una región siguiente vacía, saltar.
    if (region().y + altoTotal > region().fin && region().y + estilo.tituloAlto + 2 * filaH > region().fin) nuevaRegion();
    else if (region().y + altoTotal > region().fin) {
      const siguiente = regiones[ri + 1];
      if (siguiente && siguiente.y + altoTotal <= siguiente.fin && b.titulo === "Consumibles y recambios") nuevaRegion();
    }
    estilo.pintarTitulo(pagina(), b.titulo, region());
    for (const it of b.filas) {
      if (region().y + filaH - EPS > region().fin) {
        nuevaRegion();
        estilo.pintarTitulo(pagina(), `${b.titulo} (continuación)`, region());
      }
      if (it.tipo === "fila") pintarFila(pagina(), it.f, region(), filaH, conLetras, d.t, d.fu);
      else pintarRecambio(pagina(), it.r, region(), filaH, d.t, d.fu);
    }
  }
}

// =============================================================================
// «Tarifa»
// =============================================================================

async function pintarTarifa(m: FichaModelo, d: Documento): Promise<void> {
  const { pdf, fu, t } = d;
  const page = pdf.addPage([ANCHO * MM, ALTO * MM]);
  const paginas = [page];

  // Cabecera: logo sobre papel, referencia a la derecha, filete.
  logoOEmpresa(page, d.logo, m, MARGEN, 11, 46, 14, fu.b, t.trazo);
  if (m.referencia) {
    texto(page, `Ref. ${m.referencia}`, ANCHO - MARGEN, 19.5, 8, fu.f, t.tintaSuave, "der");
  }
  linea(page, MARGEN, 29, ANCHO - MARGEN, 29, t.linea, 0.6);

  // Columnas.
  const izqW = 78;
  const hayIzquierda = !!d.foto || m.hayDibujo || m.ventajas.length > 0;
  const derX = hayIzquierda ? MARGEN + izqW + 8 : MARGEN;
  const derW = ANCHO - MARGEN - derX;

  // --- Columna derecha: identidad ---
  let y = 37;
  texto(page, "FICHA TÉCNICA", derX, y, 7, fu.b, t.trazo, "izq", 1.1);
  y += 8.5;
  const nombreLineas = envolver(fu.b, m.nombre, 19, derW).slice(0, 2);
  for (const l of nombreLineas) {
    texto(page, l, derX, y, 19, fu.b, t.trazo);
    y += 7.4;
  }
  if (m.rasgos.length > 0) {
    let x = derX;
    const yR = y - 1.5;
    for (const r of m.rasgos) {
      const w = ancho(fu.f, r, 7) + 3.2;
      if (x + w > derX + derW) break;
      rectRedondeado(page, x, yR, w, 4.6, [0.6, 0.6, 0.6, 0.6], undefined, { color: t.linea, grosor: 0.6 });
      texto(page, r, x + 1.6, yR + 3.3, 7, fu.f, t.tinta);
      x += w + 1.6;
    }
    y += 6;
  }
  if (m.descripcion) {
    for (const l of envolver(fu.f, m.descripcion, 9, derW).slice(0, 3)) {
      texto(page, l, derX, y, 9, fu.f, t.tintaSuave);
      y += 4.2;
    }
  }
  if (m.descripcionLarga) {
    y += 1;
    for (const l of envolver(fu.f, m.descripcionLarga, 7.5, derW).slice(0, 6)) {
      texto(page, l, derX, y, 7.5, fu.f, t.tinta);
      y += 3.5;
    }
  }
  y += 3;

  // --- Reparto: ¿caben los recambios a la derecha, o van a la izquierda? ---
  const tituloAlto = 8.5;
  const finDer = PIE_Y - 4;
  const finIzq = PIE_Y - 5;
  const nVentajas = m.ventajas.length;
  const totalFilas = m.bloques.reduce((a, b) => a + b.filas.length, 0);
  const nTitulos = m.bloques.length;
  const nRec = m.recambios.length;
  const ventajasDerecha = totalFilas < 6 && nVentajas > 0;
  let filaH = elegirFila(totalFilas + nRec, nTitulos + (nRec ? 1 : 0), tituloAlto, finDer - y);
  const cabeTodo =
    y + nTitulos * tituloAlto + totalFilas * filaH + altoRecambios(nRec, filaH, tituloAlto) <= finDer;
  // Lo que no cabe a la derecha (los recambios y, con muchos datos, las
  // últimas filas) se reserva al pie de la columna izquierda.
  let recambiosIzq = 0;
  if (!cabeTodo) {
    filaH = elegirFila(totalFilas, nTitulos, tituloAlto, finDer - y);
    const exceso = Math.max(0, y + nTitulos * tituloAlto + totalFilas * filaH - finDer);
    const altoExceso = exceso > EPS ? Math.ceil(exceso / filaH) * filaH + tituloAlto : 0;
    if (hayIzquierda) recambiosIzq = altoExceso + altoRecambios(nRec, filaH, tituloAlto) + 3;
  }

  // --- Columna izquierda: foto, medidas, ventajas (y recambios si hace falta) ---
  let yi = 37;
  const altoVentajasIzq = ventajasDerecha || nVentajas === 0 ? 0 : altoVentajasLista(m, fu, izqW) + 4;
  const altoMedidas = m.hayDibujo ? 50 : 0;
  const huecoFoto = finIzq - yi - altoMedidas - (m.hayDibujo ? 5 : 0) - altoVentajasIzq;
  // La foto encoge (de 116 a 70 mm) para dejar sitio a los recambios; si ni
  // así caben, los recambios van a la hoja 2.
  if (recambiosIzq && huecoFoto - recambiosIzq < (d.foto ? 75 : 0)) recambiosIzq = 0;
  if (hayIzquierda) {
    const altoFoto = d.foto ? Math.max(70, Math.min(116, huecoFoto - recambiosIzq - 5)) : 0;
    if (d.foto) {
      rect(page, MARGEN, yi, izqW, altoFoto, t.velo);
      imagenEnCaja(page, d.foto, MARGEN + 5, yi + 5, izqW - 10, altoFoto - 7, "abajo");
      yi += altoFoto + 5;
    }
    if (m.hayDibujo) {
      if (d.medidas) imagenEnCaja(page, d.medidas, MARGEN, yi, izqW, altoMedidas, "centro");
      else dibujarCotas(page, m.cotas, MARGEN, yi, izqW, altoMedidas, t, fu.b);
      yi += altoMedidas + 5;
    }
    if (!ventajasDerecha) yi = pintarVentajasLista(page, m, d, MARGEN, yi, izqW, finIzq) + 1;
  }

  // --- Datos ---
  const estilo: EstiloFilas = {
    tituloAlto,
    pintarTitulo: (p, titulo, r) => {
      const base = r.y + 5.2;
      texto(p, titulo, r.x, base, 8.5, fu.b, t.trazo);
      linea(p, r.x, r.y + 6.8, r.x + r.w, r.y + 6.8, t.tinta, 1.1);
      r.y += tituloAlto;
    },
  };
  const regiones: Region[] = [{ x: derX, w: derW, y, fin: finDer }];
  if (recambiosIzq) regiones.push({ x: MARGEN, w: izqW, y: Math.max(yi, finIzq - recambiosIzq + 3), fin: finIzq });
  const pie = (p: PDFPage, numero?: string) => pieLinea(p, m, d.logo, t, fu, numero);
  fluir(d, m, paginas, regiones, estilo, filaH, m.recambios, pie);

  if (ventajasDerecha) {
    const r = regiones[0]!;
    pintarVentajasLista(page, m, d, r.x, r.y + 6, r.w, finDer);
  }
  pie(page, paginas.length > 1 ? "Hoja 1" : undefined);
}

/** Líneas de cada ventaja en lista (título hasta 2, texto hasta 3 - las del título). */
function lineasVentaja(fu: Fuentes, v: FichaModelo["ventajas"][number], w: number) {
  const tw = w - 12;
  const titulo = envolver(fu.b, v.titulo, 8, tw).slice(0, 2);
  const desc = v.descripcion ? envolver(fu.f, v.descripcion, 7, tw) : [];
  const maxDesc = 3 - titulo.length;
  const recorte = desc.length > maxDesc;
  const descL = desc.slice(0, maxDesc);
  if (recorte && descL.length > 0) descL[descL.length - 1] = ajustar(fu.f, `${descL[descL.length - 1]}…`, 7, tw);
  const alto = Math.max(10, 1.2 + titulo.length * 3.5 + descL.length * 3.1 + 2.6);
  return { titulo, desc: descL, alto };
}

function altoVentajasLista(m: FichaModelo, fu: Fuentes, w: number): number {
  return m.ventajas.reduce((a, v) => a + lineasVentaja(fu, v, w).alto, 0);
}

/** Ventajas en lista: icono reentintado de 9 mm (o rombo) + título + texto breve. */
function pintarVentajasLista(page: PDFPage, m: FichaModelo, d: Documento, x: number, y: number, w: number, fin: number): number {
  const { fu, t } = d;
  m.ventajas.forEach((v, i) => {
    const { titulo, desc, alto } = lineasVentaja(fu, v, w);
    if (y + 9 > fin) return;
    const icono = d.iconos[i] ?? null;
    if (icono) imagenEnCaja(page, icono, x, y, 9, 9, "centro");
    else rombo(page, x + 4.5, y + 4.5, 2.2, t.acentoMarca);
    const tx = x + 12;
    let yy = y + 3.4;
    for (const l of titulo) {
      texto(page, l, tx, yy, 8, fu.b, t.tinta);
      yy += 3.5;
    }
    for (const l of desc) {
      texto(page, l, tx, yy, 7, fu.f, t.tintaSuave);
      yy += 3.1;
    }
    y += alto;
  });
  return y;
}

// =============================================================================
// «Escaparate»
// =============================================================================

async function pintarEscaparate(m: FichaModelo, d: Documento): Promise<void> {
  const { pdf, fu, t } = d;
  const page = pdf.addPage([ANCHO * MM, ALTO * MM]);
  const paginas = [page];
  const FRANJA = 46;

  // Franja a sangre con el nombre encima.
  rect(page, 0, 0, ANCHO, FRANJA, t.campo);
  // Pestaña blanca pegada al borde superior con el logo («Del Logo en Papel»).
  rectRedondeado(page, MARGEN, 0, 56, 21, [0, 0, 3, 3], t.papel);
  logoOEmpresa(page, d.logo, m, MARGEN + 5, 3.5, 46, 14, fu.b, t.trazo);

  const izqW = 80;
  const derX = MARGEN + izqW + 6;
  const derW = ANCHO - MARGEN - derX;
  if (m.referencia) texto(page, `Ref. ${m.referencia}`, ANCHO - MARGEN, 8, 8, fu.f, t.sobreCampo, "der");
  texto(page, "FICHA TÉCNICA", derX, 14, 7, fu.b, t.sobreCampo, "izq", 1.1);
  const nombreLineas = envolver(fu.b, m.nombre, 20, derW).slice(0, 2);
  let yn = nombreLineas.length > 1 ? 22 : 25;
  for (const l of nombreLineas) {
    texto(page, l, derX, yn, 20, fu.b, t.sobreCampo);
    yn += 7.6;
  }
  if (m.rasgos.length > 0) {
    texto(page, ajustar(fu.f, m.rasgos.join("  ·  "), 8, derW), derX, Math.min(yn + 0.5, FRANJA - 4), 8, fu.f, t.sobreCampo);
  }

  // Derecha: descripción (se mide antes para decidir el reparto).
  let y = FRANJA + 8;
  if (m.descripcion) {
    for (const l of envolver(fu.b, m.descripcion, 10, derW).slice(0, 3)) {
      texto(page, l, derX, y, 10, fu.b, t.tinta);
      y += 4.6;
    }
  }
  if (m.descripcionLarga) {
    for (const l of envolver(fu.f, m.descripcionLarga, 7.5, derW).slice(0, 6)) {
      texto(page, l, derX, y, 7.5, fu.f, t.tinta);
      y += 3.5;
    }
  }
  y += 2.5;

  // Reparto. Normal: ventajas en tira sobre el pie y filas de 5 mm o más.
  // Si no cabe, modo denso: sin tira (ventajas y recambios a la izquierda)
  // y la fila baja hasta 4,6 mm.
  const tituloAlto = 8.5;
  const totalFilas = m.bloques.reduce((a, b) => a + b.filas.length, 0);
  const nTitulos = m.bloques.length;
  const nRec = m.recambios.length;
  const altoTira = m.ventajas.length > 0 ? 27 : 0;
  const cabe = (fin: number, fh: number, conRec: boolean) =>
    y + nTitulos * tituloAlto + totalFilas * fh + (conRec ? altoRecambios(nRec, fh, tituloAlto) : 0) <= fin;
  let denso = false;
  let finDer = PIE_Y - 6 - altoTira;
  let recIzq = false;
  let filaH = Math.max(5, elegirFila(totalFilas + nRec, nTitulos + (nRec ? 1 : 0), tituloAlto, finDer - y));
  if (!cabe(finDer, filaH, true)) {
    recIzq = nRec > 0;
    filaH = Math.max(5, elegirFila(totalFilas, nTitulos, tituloAlto, finDer - y));
    if (!cabe(finDer, filaH, false)) {
      denso = true;
      finDer = PIE_Y - 4;
      filaH = elegirFila(totalFilas, nTitulos, tituloAlto, finDer - y);
    }
  }

  // Foto: si es transparente, el equipo PISA el borde de la franja 22 mm y se
  // apoya en una línea. Una foto con fondo taparía la franja: empieza debajo.
  // Lo que tiene que caber debajo de la foto a la izquierda: medidas,
  // ventajas (en modo denso), lo que sobre de la derecha y los recambios.
  const finIzq = denso ? PIE_Y - 5 : PIE_Y - 6 - altoTira;
  const altoMedidasIzq = m.hayDibujo ? (denso ? 44 : 56) + 4 : 0;
  const excesoDer = Math.max(0, y + nTitulos * tituloAlto + totalFilas * filaH - finDer);
  const altoAbajo =
    6 +
    altoMedidasIzq +
    (denso && m.ventajas.length ? altoVentajasLista(m, fu, izqW) + 1 : 0) +
    (excesoDer > EPS ? Math.ceil(excesoDer / filaH) * filaH + tituloAlto : 0) +
    (recIzq ? altoRecambios(nRec, filaH, tituloAlto) : 0);
  let yi: number;
  const baseFoto = Math.min(denso ? 132 : 150, Math.max(100, finIzq - altoAbajo));
  if (d.foto) {
    const arriba = d.fotoTransparente ? FRANJA - 22 : FRANJA + 6;
    const caja = imagenEnCaja(page, d.foto, MARGEN + 4, arriba, izqW - 8, baseFoto - arriba - 1, d.fotoTransparente ? "arriba" : "abajo");
    const yLinea = caja.y + caja.h + 1;
    linea(page, MARGEN, yLinea, MARGEN + izqW, yLinea, t.tinta, 0.6);
    yi = yLinea + 6;
  } else {
    yi = FRANJA + 8;
  }
  if (m.hayDibujo) {
    const h = Math.min(denso ? 44 : 56, finIzq - yi);
    if (h > 25) {
      if (d.medidas) imagenEnCaja(page, d.medidas, MARGEN, yi, izqW, h, "arriba");
      else dibujarCotas(page, m.cotas, MARGEN, yi, izqW, h, t, fu.b);
      yi += h + 4;
    }
  }
  if (denso && m.ventajas.length > 0) yi = pintarVentajasLista(page, m, d, MARGEN, yi, izqW, finIzq) + 1;

  const estilo: EstiloFilas = {
    tituloAlto,
    pintarTitulo: (p, titulo, r) => {
      texto(p, titulo, r.x, r.y + 5, 8.5, fu.b, t.tinta);
      linea(p, r.x, r.y + 6.8, r.x + r.w, r.y + 6.8, t.trazo, 1.6);
      r.y += tituloAlto;
    },
  };
  const regiones: Region[] = [{ x: derX, w: derW, y, fin: finDer }];
  if ((recIzq || excesoDer > EPS) && finIzq - yi >= tituloAlto + filaH) {
    regiones.push({ x: MARGEN, w: izqW, y: yi, fin: finIzq });
  }
  const pie = (p: PDFPage, numero?: string) => pieEscaparate(p, m, d, numero);
  fluir(d, m, paginas, regiones, estilo, filaH, m.recambios, pie);

  // Ventajas: en fila horizontal sobre el pie, icono de 11 mm.
  if (!denso && m.ventajas.length > 0) {
    const n = m.ventajas.length;
    const yV = PIE_Y - 4 - altoTira;
    const celda = UTIL / n;
    m.ventajas.forEach((v, i) => {
      const cx = MARGEN + celda * i + celda / 2;
      const icono = d.iconos[i] ?? null;
      if (icono) imagenEnCaja(page, icono, cx - 5.5, yV, 11, 11, "centro");
      else rombo(page, cx, yV + 5.5, 2.8, t.acentoMarca);
      envolver(fu.b, v.titulo, 7.5, celda - 4)
        .slice(0, 2)
        .forEach((l, k) => texto(page, l, cx, yV + 15.5 + k * 3.3, 7.5, fu.b, t.tinta, "centro"));
    });
  }
  pie(page, paginas.length > 1 ? "Hoja 1" : undefined);
}

/** Pie de «Escaparate»: pieza de contacto con el teléfono en grande. */
function pieEscaparate(page: PDFPage, m: FichaModelo, d: Documento, numero?: string) {
  const { fu, t } = d;
  linea(page, MARGEN, PIE_Y, ANCHO - MARGEN, PIE_Y, t.trazo, 1.2);
  let x = MARGEN;
  if (d.logo) {
    const c = imagenEnCaja(page, d.logo, MARGEN, PIE_Y + 3, 30, 10, "centro", "izq");
    x = c.x + c.w + 5;
  }
  const tel = m.empresa.telefono;
  const wTel = tel ? ancho(fu.b, tel, 16) + 2 : 0;
  const max = ANCHO - MARGEN - x - wTel - 6;
  envolver(fu.f, lineaContacto(m, false), 7, max)
    .slice(0, 2)
    .forEach((l, i) => texto(page, l, x, PIE_Y + 6.5 + i * 3.6, 7, fu.f, t.tinta));
  if (tel) {
    texto(page, "Llámanos", ANCHO - MARGEN, PIE_Y + 4.8, 6.5, fu.f, t.tintaSuave, "der");
    texto(page, tel, ANCHO - MARGEN, PIE_Y + 11.5, 16, fu.b, t.acentoTexto, "der");
  }
  const rev = m.revision ? `Rev. ${m.revision}${numero ? `  ·  ${numero}` : ""}  ·  ` : "";
  texto(page, `${rev}${AVISO}`, ANCHO / 2, ALTO - 6, 6, fu.f, t.tintaSuave, "centro");
}

// =============================================================================
// «Placa»
// =============================================================================

async function pintarPlaca(m: FichaModelo, d: Documento): Promise<void> {
  const { pdf, fu, t } = d;
  let page = pdf.addPage([ANCHO * MM, ALTO * MM]);
  const M = 10;
  const W = ANCHO - 2 * M;
  const marco = (p: PDFPage) =>
    rectRedondeado(p, M, M, W, ALTO - 2 * M, [2.5, 2.5, 2.5, 2.5], undefined, { color: t.trazo, grosor: 0.9 });
  marco(page);

  // Cabecera en rejilla: logo · nombre y rasgos · referencia (la única celda de color).
  const altoCab = 24;
  const c1 = 54;
  const c3 = 46;
  const c2 = W - c1 - c3;
  logoOEmpresa(page, d.logo, m, M + 4, M + 5, c1 - 8, altoCab - 10, fu.b, t.trazo);
  linea(page, M + c1, M, M + c1, M + altoCab, t.trazo, 0.5);
  const nl = envolver(fu.b, m.nombre, 15, c2 - 8).slice(0, 2);
  let yn = M + (nl.length > 1 ? 8.5 : 11);
  for (const l of nl) {
    texto(page, l, M + c1 + 4, yn, 15, fu.b, t.tinta);
    yn += 5.8;
  }
  if (m.rasgos.length) texto(page, ajustar(fu.f, m.rasgos.join(" · "), 7, c2 - 8), M + c1 + 4, Math.min(yn, M + altoCab - 3), 7, fu.f, t.tintaSuave);
  rectRedondeado(page, M + c1 + c2, M, c3, altoCab, [0, 2.5, 0, 0], t.campo);
  texto(page, "FICHA TÉCNICA", M + c1 + c2 + 4, M + 8, 7, fu.b, t.sobreCampo, "izq", 1);
  if (m.referencia) texto(page, ajustar(fu.mb, m.referencia, 10, c3 - 8), M + c1 + c2 + 4, M + 15, 10, fu.mb, t.sobreCampo);
  if (m.revision) texto(page, `Rev. ${m.revision}`, M + c1 + c2 + 4, M + 20.5, 6.5, fu.f, t.sobreCampo);
  linea(page, M, M + altoCab, M + W, M + altoCab, t.trazo, 0.9);

  // Datos en campos de placa (se miden antes para ajustar la fila de imágenes).
  const finPag = ALTO - M - 16;
  const COLS = 3;
  const tituloAlto = 5.6;
  const LISTA_H = 5.4;
  const grupos: Array<{
    titulo: string;
    lista: boolean;
    campos: Array<{ etiqueta: string; valor: string; cota: string | null }>;
  }> = m.bloques.map((b) => ({
    titulo: b.titulo,
    lista: false,
    campos: b.filas.map((f) => ({
      etiqueta: f.etiqueta,
      valor: f.unidad ? `${f.valor} ${f.unidad}` : f.valor,
      cota: f.cota,
    })),
  }));
  if (m.recambios.length) {
    grupos.push({
      titulo: "Consumibles y recambios",
      lista: true,
      campos: m.recambios.map((r) => ({
        etiqueta: r.detalle ?? "",
        valor: `${r.cantidad ?? 1} x ${r.nombre}`,
        cota: null,
      })),
    });
  }
  const filasCampo = grupos.filter((g) => !g.lista).reduce((a, g) => a + Math.ceil(g.campos.length / COLS), 0);
  const filasLista = grupos.filter((g) => g.lista).reduce((a, g) => a + g.campos.length, 0);
  const altoVentajas = m.ventajas.length > 0 ? 9.2 : 0;
  const altoTitulos = grupos.length * tituloAlto;

  // Fila de imágenes: foto (58 mm) · medidas · descripción. Encoge de 62 a
  // 44 mm si los datos lo necesitan para caber en una hoja.
  let y = M + altoCab;
  const hayImagenes = !!d.foto || m.hayDibujo;
  const libre = finPag - y - altoVentajas - altoTitulos - filasCampo * 8.4 - filasLista * LISTA_H;
  const altoImg = hayImagenes ? Math.max(44, Math.min(62, libre)) : 0;
  if (altoImg) {
    let x = M;
    if (d.foto) {
      imagenEnCaja(page, d.foto, x + 3, y + 3, 52, altoImg - 6, "abajo");
      x += 58;
      linea(page, x, y, x, y + altoImg, t.linea, 0.5);
    }
    if (m.hayDibujo) {
      const w = 66;
      if (d.medidas) imagenEnCaja(page, d.medidas, x + 3, y + 3, w - 6, altoImg - 6, "centro");
      else dibujarCotas(page, m.cotas, x + 2, y + 2, w - 4, altoImg - 4, t, fu.b);
      x += w;
      linea(page, x, y, x, y + altoImg, t.linea, 0.5);
    }
    const wd = M + W - x - 6;
    let yd = y + 6;
    if (m.descripcion && wd > 30) {
      for (const l of envolver(fu.b, m.descripcion, 8.5, wd).slice(0, 4)) {
        texto(page, l, x + 3, yd, 8.5, fu.b, t.tinta);
        yd += 3.9;
      }
    }
    if (m.descripcionLarga && wd > 30) {
      yd += 1;
      for (const l of envolver(fu.f, m.descripcionLarga, 7, wd).slice(0, Math.floor((y + altoImg - yd - 2) / 3.2))) {
        texto(page, l, x + 3, yd, 7, fu.f, t.tinta);
        yd += 3.2;
      }
    }
    y += altoImg;
    linea(page, M, y, M + W, y, t.trazo, 0.6);
  } else if (m.descripcion) {
    texto(page, ajustar(fu.b, m.descripcion, 8.5, W - 8), M + 4, y + 6, 8.5, fu.b, t.tinta);
    y += 9;
    linea(page, M, y, M + W, y, t.trazo, 0.6);
  }

  // Ventajas: franja de una línea con icono de 6 mm.
  if (m.ventajas.length > 0) {
    const n = m.ventajas.length;
    const celda = W / n;
    m.ventajas.forEach((v, i) => {
      const x = M + celda * i + 2.5;
      const icono = d.iconos[i] ?? null;
      if (icono) imagenEnCaja(page, icono, x, y + 1.6, 6, 6, "centro");
      else rombo(page, x + 3, y + 4.6, 1.7, t.acentoMarca);
      const lineas = envolver(fu.b, v.titulo, 6.5, celda - 11).slice(0, 2);
      lineas.forEach((l, k) =>
        texto(page, l, x + 7.5, y + (lineas.length > 1 ? 3.9 : 5.5) + k * 2.9, 6.5, fu.b, t.tinta),
      );
    });
    y += altoVentajas;
    linea(page, M, y, M + W, y, t.trazo, 0.6);
  }

  const disponible = finPag - y - altoTitulos - filasLista * LISTA_H;
  const campoH = Math.max(8, Math.min(10, filasCampo ? disponible / filasCampo : 10));

  const pieP = (p: PDFPage, numero?: string) => piePlaca(p, m, d, M, W, numero);
  const nuevaHoja = () => {
    pieP(page, `Hoja ${pdf.getPageCount()}`);
    page = pdf.addPage([ANCHO * MM, ALTO * MM]);
    marco(page);
    cabeceraHoja2Placa(page, m, d, M, W);
    y = M + 16;
  };
  const tituloGrupo = (titulo: string) => {
    rect(page, M, y, W, tituloAlto, t.velo);
    texto(page, titulo.toUpperCase(), M + 3, y + 3.9, 6.8, fu.b, t.tinta, "izq", 0.5);
    y += tituloAlto;
  };
  let partida = false;
  for (const g of grupos) {
    const h = g.lista ? LISTA_H : campoH;
    if (y + tituloAlto + h > finPag) {
      nuevaHoja();
      partida = true;
    }
    tituloGrupo(g.titulo);
    const porFila = g.lista ? 1 : COLS;
    const wc = W / porFila;
    for (let i = 0; i < g.campos.length; i += porFila) {
      if (y + h > finPag) {
        nuevaHoja();
        partida = true;
        tituloGrupo(`${g.titulo} (continuación)`);
      }
      g.campos.slice(i, i + porFila).forEach((c, k) => {
        const x = M + wc * k;
        const xl = x + 3;
        if (g.lista) {
          // Una línea: «1 x Filtro …» y, a la derecha, la periodicidad.
          const wDet = c.etiqueta ? ancho(fu.f, c.etiqueta, 6.5) + 4 : 0;
          texto(page, ajustar(fu.mb, c.valor, 7.4, wc - 6 - wDet), xl, y + 3.7, 7.4, fu.mb, t.tinta);
          if (c.etiqueta) texto(page, c.etiqueta, x + wc - 3, y + 3.7, 6.5, fu.f, t.tintaSuave, "der");
          return;
        }
        const sizeEt = 6;
        let xe = xl;
        if (c.cota) {
          texto(page, c.cota, xl, y + 3.1, sizeEt + 1, fu.b, t.acentoMarca);
          xe += 3;
        }
        texto(page, ajustar(fu.f, c.etiqueta, sizeEt, wc - 6 - (xe - xl)), xe, y + 3.0, sizeEt, fu.f, t.tintaSuave);
        let s = h < 8.6 ? 7.8 : 8.4;
        while (s > 6.2 && ancho(fu.mb, c.valor, s) > wc - 6) s -= 0.2;
        texto(page, ajustar(fu.mb, c.valor, s, wc - 6), xl, y + h - 1.7, s, fu.mb, t.tinta);
        if (k > 0) linea(page, x, y, x, y + h, t.linea, 0.4);
      });
      y += h;
      linea(page, M, y, M + W, y, t.linea, 0.4);
    }
  }
  // El pie de las hojas anteriores lo pone nuevaHoja(); este es el de la última.
  pieP(page, partida ? `Hoja ${pdf.getPageCount()}` : undefined);
}

function cabeceraHoja2Placa(page: PDFPage, m: FichaModelo, d: Documento, M: number, W: number) {
  logoOEmpresa(page, d.logo, m, M + 4, M + 3, 36, 9, d.fu.b, d.t.trazo);
  texto(page, ajustar(d.fu.b, `${m.nombre} (continuación)`, 10, W - 50), M + W - 4, M + 9.5, 10, d.fu.b, d.t.tinta, "der");
  linea(page, M, M + 15, M + W, M + 15, d.t.trazo, 0.9);
}

/** Pie de «Placa»: rejilla empresa · contacto · aviso. */
function piePlaca(page: PDFPage, m: FichaModelo, d: Documento, M: number, W: number, numero?: string) {
  const { fu, t } = d;
  const y = ALTO - M - 14;
  linea(page, M, y, M + W, y, t.trazo, 0.9);
  const c1 = 62;
  const c2 = W - c1 - 50;
  if (d.logo) imagenEnCaja(page, d.logo, M + 3, y + 2.5, 22, 9, "centro", "izq");
  const xEmp = d.logo ? M + 28 : M + 3;
  texto(page, ajustar(fu.b, m.empresa.razonSocial ?? m.empresa.nombre, 7, c1 - (xEmp - M) - 2), xEmp, y + 6, 7, fu.b, t.tinta);
  if (m.empresa.localidad) texto(page, ajustar(fu.f, m.empresa.localidad, 6.5, c1 - (xEmp - M) - 2), xEmp, y + 9.8, 6.5, fu.f, t.tintaSuave);
  linea(page, M + c1, y, M + c1, y + 14, t.linea, 0.5);
  const contacto = [m.empresa.telefono, m.empresa.correo, m.empresa.web].filter((x): x is string => !!x);
  contacto.slice(0, 3).forEach((c, i) =>
    texto(page, ajustar(i === 0 ? fu.mb : fu.m, c, 7, c2 - 6), M + c1 + 3, y + 4.6 + i * 3.4, 7, i === 0 ? fu.mb : fu.m, t.tinta),
  );
  linea(page, M + c1 + c2, y, M + c1 + c2, y + 14, t.linea, 0.5);
  const xa = M + c1 + c2 + 3;
  envolver(fu.f, AVISO, 6, 44)
    .slice(0, 2)
    .forEach((l, i) => texto(page, l, xa, y + 5 + i * 2.8, 6, fu.f, t.tintaSuave));
  if (numero) texto(page, numero, M + W - 3, y + 11.5, 6, fu.f, t.tintaSuave, "der");
}

// =============================================================================
// Entrada
// =============================================================================

export async function pintarFicha(args: {
  modelo: FichaModelo;
  plantilla: PlantillaNueva;
  paleta: PaletaFicha;
  imagenes: ImagenesFicha;
}): Promise<Uint8Array> {
  const d = await prepararDocumento(args.modelo, args.paleta, args.imagenes);
  if (args.plantilla === "escaparate") await pintarEscaparate(args.modelo, d);
  else if (args.plantilla === "placa") await pintarPlaca(args.modelo, d);
  else await pintarTarifa(args.modelo, d);
  return d.pdf.save();
}
