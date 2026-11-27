import "server-only";
import { degrees, PDFDocument, PDFString, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import { withSanitizer, wrap } from "@/shared/lib/pdf/dashstack";
import { descargar, incrustar, prepararImagen } from "@/modules/products/ficha/imagenes";
import { formatearTelefono } from "@/modules/products/ficha/modelo";
import {
  ACCION,
  derivarPaletaPropuesta,
  enlaceWaMe,
  fechaCorta,
  fechaSello,
  filasDatos,
  hayPrecios,
  limpiarTextoPdf,
  NOTA_SIN_PRECIOS,
  referenciaDe,
  textoQueMeLlameis,
  TITULO_RELACION,
  type LineaPropuesta,
} from "./propuesta-logica";
import { cargarEmpresaPropuesta, lineaFiscal, type EmpresaPropuesta, type FilaPropuesta } from "./propuesta-servidor";

/**
 * PDF de la propuesta de captación (docs/DISENO_PROPUESTA_CAPTACION.md §6).
 * Sin sesión: recibe company_id y lee con el cliente de servicio. A4
 * vertical, una hoja con hasta tres equipos y dos con cuatro a seis. Tipos
 * estándar (Helvetica y Courier), sin incrustar nada. Papel blanco: aquí los
 * colores de derivarPaleta() valen tal cual (se calcularon contra blanco).
 *
 * Medidas en milímetros desde el borde SUPERIOR del papel; cuerpos en puntos.
 */

const MM = 72 / 25.4;
const PT = 25.4 / 72;
const ANCHO = 210;
const ALTO = 297;
const MARGEN = 12;
const UTIL = ANCHO - 2 * MARGEN; // 186
const DERECHA = ANCHO - MARGEN; // 198
const LIMITE = 285; // último milímetro útil (pie incluido)

const X = (mm: number) => mm * MM;
const Y = (mm: number) => (ALTO - mm) * MM;

interface Fuentes {
  h: PDFFont;
  hb: PDFFont;
  c: PDFFont;
  cb: PDFFont;
}

interface Tintas {
  tinta: RGB;
  suave: RGB;
  velo: RGB;
  campo: RGB;
  sobreCampo: RGB;
  trazo: RGB;
  filete: RGB;
}

function aRgb(hex: string): RGB {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

const ancho = (f: PDFFont, t: string, size: number) => f.widthOfTextAtSize(t, size) * PT;

/** Texto en una línea base (mm desde arriba). */
function txt(
  page: PDFPage,
  t: string,
  x: number,
  base: number,
  f: PDFFont,
  size: number,
  color: RGB,
  alinear: "izq" | "der" | "centro" = "izq",
): void {
  if (!t) return;
  const w = ancho(f, t, size);
  const x0 = alinear === "der" ? x - w : alinear === "centro" ? x - w / 2 : x;
  page.drawText(t, { x: X(x0), y: Y(base), size, font: f, color });
}

function linea(page: PDFPage, x1: number, y1: number, x2: number, y2: number, grosor: number, color: RGB, guiones?: number[]): void {
  page.drawLine({
    start: { x: X(x1), y: Y(y1) },
    end: { x: X(x2), y: Y(y2) },
    thickness: grosor,
    color,
    ...(guiones ? { dashArray: guiones } : {}),
  });
}

function caja(page: PDFPage, x: number, y: number, w: number, h: number, o: { relleno?: RGB; borde?: RGB; grosor?: number }): void {
  page.drawRectangle({
    x: X(x),
    y: Y(y + h),
    width: w * MM,
    height: h * MM,
    ...(o.relleno ? { color: o.relleno } : {}),
    ...(o.borde ? { borderColor: o.borde, borderWidth: o.grosor ?? 0.4 } : {}),
  });
}

/** Imagen contenida en una caja, centrada en vertical, alineada a la izquierda. */
function imagenEnCaja(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number): void {
  const r = Math.min(w / img.width, h / img.height);
  const dw = img.width * r;
  const dh = img.height * r;
  page.drawImage(img, { x: X(x), y: Y(y + (h - dh) / 2 + dh), width: dw * MM, height: dh * MM });
}

/**
 * Corta un texto a `maxLineas` POR FRASE COMPLETA (§6.2): nunca con puntos
 * suspensivos. Si la primera frase ya no cabe, por palabra y con punto.
 */
function lineasPorFrase(f: PDFFont, t: string, size: number, anchoMm: number, maxLineas: number): string[] {
  if (maxLineas <= 0 || !t) return [];
  const w = anchoMm * MM;
  let lineas = wrap(f, t, size, w);
  if (lineas.length <= maxLineas) return lineas;
  const frases = t.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let acumulado = "";
  let mejor: string[] = [];
  for (const fr of frases) {
    const cand = (acumulado + fr).trim();
    const l = wrap(f, cand, size, w);
    if (l.length > maxLineas) break;
    acumulado += fr;
    mejor = l;
  }
  if (mejor.length > 0) return mejor;
  lineas = lineas.slice(0, maxLineas);
  const ultima = lineas[maxLineas - 1]!.split(" ");
  if (ultima.length > 1) ultima.pop();
  lineas[maxLineas - 1] = `${ultima.join(" ").replace(/[,;:]$/, "")}.`;
  return lineas;
}

/** Un dato a máquina que no cabe se achica hasta `minimo` pt y, si aún no, va en dos líneas. */
function datoAjustado(f: PDFFont, t: string, size: number, anchoMm: number, minimo = 8): { size: number; lineas: string[] } {
  for (let s = size; s >= minimo; s -= 0.5) if (ancho(f, t, s) <= anchoMm) return { size: s, lineas: [t] };
  return { size: minimo, lineas: wrap(f, t, minimo, anchoMm * MM).slice(0, 2) };
}

// -----------------------------------------------------------------------------
// Imágenes (el multiply se hace en sharp, §6.6)
// -----------------------------------------------------------------------------

async function fotoEnPanel(buf: Buffer | null, wPx: number, hPx: number, airePx: number, velo: string): Promise<Uint8Array | null> {
  if (!buf) return null;
  try {
    const dentro = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: wPx - 2 * airePx, height: hPx - 2 * airePx, fit: "inside" })
      .flatten({ background: "#ffffff" })
      .toBuffer({ resolveWithObject: true });
    const out = await sharp({ create: { width: wPx, height: hPx, channels: 3, background: velo } })
      .composite([
        {
          input: dentro.data,
          left: Math.round((wPx - dentro.info.width) / 2),
          top: Math.round((hPx - dentro.info.height) / 2),
          blend: "multiply",
        },
      ])
      .jpeg({ quality: 80 })
      .toBuffer();
    return new Uint8Array(out);
  } catch (e) {
    console.error("[captacion/pdf] foto:", e instanceof Error ? e.message : e);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Piezas
// -----------------------------------------------------------------------------

interface Lienzo {
  pdf: PDFDocument;
  fu: Fuentes;
  t: Tintas;
  empresa: EmpresaPropuesta;
  prop: FilaPropuesta;
  logo: PDFImage | null;
  waMe: string | null;
  ref: string;
  nombre: string;
  conPrecios: boolean;
}

function membrete(page: PDFPage, l: Lienzo): number {
  const { fu, t } = l;
  if (l.logo) imagenEnCaja(page, l.logo, MARGEN, 15, 46, 14);
  else txt(page, limpiarTextoPdf(l.empresa.nombre), MARGEN, 24, fu.hb, 12, t.tinta);
  const derecha = [formatearTelefono(l.empresa.telefono), l.empresa.email, l.empresa.ciudad]
    .filter((x): x is string => !!x)
    .map(limpiarTextoPdf);
  derecha.forEach((d, i) => txt(page, d, DERECHA, 17 + i * 3.6, fu.c, 7.5, t.suave, "der"));
  linea(page, MARGEN, 32, DERECHA, 32, 0.6, t.trazo);
  return 32;
}

/** Membrete reducido de la hoja 2 (14 mm). */
function membreteReducido(page: PDFPage, l: Lienzo): number {
  const { fu, t } = l;
  if (l.logo) imagenEnCaja(page, l.logo, MARGEN, 12, 30, 9);
  else txt(page, limpiarTextoPdf(l.empresa.nombre), MARGEN, 18, fu.hb, 10, t.tinta);
  // «propuesta para» y el nombre a máquina, alineados a la derecha (hasta dos líneas).
  txt(page, "propuesta para", DERECHA, 15, fu.h, 7, t.suave, "der");
  const nombre = datoAjustado(fu.cb, l.nombre, 9, 120, 7.5);
  nombre.lineas.forEach((n, i) => txt(page, n, DERECHA, 19 + i * 3.4, fu.cb, nombre.size, t.tinta, "der"));
  linea(page, MARGEN, 26, DERECHA, 26, 0.6, t.trazo);
  return 26;
}

/** Sello «VÁLIDA HASTA», girado −4° (en PDF, +4°: el eje Y sube), centrado en (cx, cy). */
function sello(page: PDFPage, l: Lienzo, cx: number, cy: number): void {
  const { fu, t } = l;
  const w = 44;
  const h = 15;
  const ang = (4 * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  // Punto local (dx a la derecha, dy hacia ARRIBA, en mm) → coordenadas PDF.
  const punto = (dx: number, dy: number) => ({
    x: X(cx) + (dx * cos - dy * sin) * MM,
    y: Y(cy) + (dx * sin + dy * cos) * MM,
  });
  const rect = (dw: number, dh: number, grosor: number) => {
    const p = punto(-dw / 2, -dh / 2);
    page.drawRectangle({ x: p.x, y: p.y, width: dw * MM, height: dh * MM, borderColor: t.trazo, borderWidth: grosor, rotate: degrees(4) });
  };
  rect(w, h, 1.2);
  rect(w - 2.4, h - 2.4, 0.4);
  const linea1 = "VÁLIDA HASTA";
  const linea2 = fechaSello(l.prop.caduca_at);
  const p1 = punto(-ancho(fu.cb, linea1, 7) / 2, 1.2);
  const p2 = punto(-ancho(fu.cb, linea2, 10) / 2, -4.0);
  page.drawText(linea1, { x: p1.x, y: p1.y, size: 7, font: fu.cb, color: t.trazo, rotate: degrees(4) });
  page.drawText(linea2, { x: p2.x, y: p2.y, size: 10, font: fu.cb, color: t.trazo, rotate: degrees(4) });
}

/** Casillas (§6.2): «propuesta para» + sello; tipo · localidad · fecha · ref. */
function casillas(page: PDFPage, l: Lienzo, y0: number): number {
  const { fu, t } = l;
  // Fila A: el nombre baja de 15 a 11 pt y, si aún no cabe, a dos líneas de 10.
  const anchoNombre = 134 - 6;
  let tam = 15;
  let lineasNombre = [l.nombre];
  while (tam > 11 && ancho(fu.cb, l.nombre, tam) > anchoNombre) tam -= 0.5;
  if (ancho(fu.cb, l.nombre, tam) > anchoNombre) {
    tam = 10;
    lineasNombre = wrap(fu.cb, l.nombre, tam, anchoNombre * MM).slice(0, 2);
  }
  const altoA = lineasNombre.length > 1 ? 15 : 12;
  caja(page, MARGEN, y0, 134, altoA, { borde: t.filete });
  caja(page, MARGEN + 134, y0, 52, altoA, { borde: t.filete });
  txt(page, "propuesta para", MARGEN + 3, y0 + 3.4, fu.h, 7, t.suave);
  lineasNombre.forEach((n, i) => txt(page, n, MARGEN + 3, y0 + 9.2 + i * 4.4, fu.cb, tam, t.tinta));

  // Fila B: «Sin Dato, Sin Hueco»: lo que falta no se pinta y el resto se reparte.
  const yB = y0 + altoA;
  const variables = [
    l.prop.tipo_negocio ? { r: "tipo de negocio", v: limpiarTextoPdf(l.prop.tipo_negocio) } : null,
    l.prop.localidad ? { r: "localidad", v: limpiarTextoPdf(l.prop.localidad) } : null,
  ].filter((x): x is { r: string; v: string } => !!x);
  const celdas = [
    ...variables.map((c) => ({ ...c, w: 124 / variables.length })),
    { r: "fecha", v: fechaCorta(l.prop.created_at), w: variables.length ? 31 : 93 },
    { r: "ref.", v: l.ref, w: variables.length ? 31 : 93 },
  ];
  let x = MARGEN;
  for (const c of celdas) {
    caja(page, x, yB, c.w, 10, { borde: t.filete });
    txt(page, c.r, x + 3, yB + 3.4, fu.h, 7, t.suave);
    const d = datoAjustado(fu.c, c.v, 9, c.w - 6);
    txt(page, d.lineas[0] ?? "", x + 3, yB + 7.8, fu.c, d.size, t.tinta);
    x += c.w;
  }
  // El sello sobresale de su casilla por abajo (menos de los 2 mm del diseño:
  // con 2 mm tapaba el rótulo «ref.» de la fila de debajo).
  sello(page, l, MARGEN + 134 + 26, y0 + altoA + 0.8 - 7.5);
  return yB + 10;
}

function carta(page: PDFPage, l: Lienzo, y0: number): number {
  const { fu, t } = l;
  const paso = 14.5 * PT;
  txt(page, "Hola:", MARGEN, y0 + 3.6, fu.h, 10, t.tinta);
  const cuerpo = wrap(fu.h, limpiarTextoPdf(l.prop.carta ?? ""), 10, 130 * MM);
  cuerpo.forEach((c, i) => txt(page, c, MARGEN, y0 + 3.6 + (i + 1) * paso, fu.h, 10, t.tinta));
  const yFirma = y0 + 3.6 + (cuerpo.length + 1) * paso + 1;
  txt(page, limpiarTextoPdf(`El equipo de ${l.empresa.nombre}`), MARGEN, yFirma, fu.c, 9, t.tinta);
  return yFirma + 1.5;
}

function tituloRelacion(page: PDFPage, l: Lienzo, y0: number, n: number): number {
  const { fu, t } = l;
  txt(page, TITULO_RELACION(n), MARGEN, y0 + 4.6, fu.hb, 12, t.tinta);
  txt(page, String(n), DERECHA, y0 + 4.6, fu.c, 9, t.tinta, "der");
  linea(page, MARGEN, y0 + 7, DERECHA, y0 + 7, 0.4, t.filete);
  return y0 + 7;
}

/** Filas «rótulo | dato» desde (x, y); devuelve el alto que ocupan. */
function casillaDatos(page: PDFPage, l: Lienzo, linea_: LineaPropuesta, x: number, y: number, w: number, dibujar = true): number {
  const { fu, t } = l;
  const filas = filasDatos(linea_, l.conPrecios);
  const colRotulo = 20;
  let yy = y;
  for (const f of filas) {
    const d = datoAjustado(fu.c, limpiarTextoPdf(f.valor), 9, w - colRotulo - 2);
    const alto = (f.leyenda ? 8 : 6) + (d.lineas.length > 1 ? 3 : 0);
    if (dibujar) {
      linea(page, x, yy, x + w, yy, 0.4, t.filete);
      txt(page, f.rotulo, x, yy + 4.1, fu.h, 8, t.suave);
      d.lineas.forEach((ln, i) => txt(page, ln, x + colRotulo, yy + 4.1 + i * 3, fu.c, d.size, t.tinta));
      if (f.leyenda) txt(page, f.leyenda, x + colRotulo, yy + 7 + (d.lineas.length - 1) * 3, fu.h, 6.5, t.suave);
    }
    yy += alto;
  }
  return yy - y;
}

async function partidaPrincipal(page: PDFPage, l: Lienzo, ln: LineaPropuesta, n: number, y0: number, alto: number, foto: PDFImage | null): Promise<number> {
  const { fu, t } = l;
  const x0 = foto ? MARGEN + 62 + 6 : MARGEN;
  const w = foto ? 118 : UTIL;
  if (foto) page.drawImage(foto, { x: X(MARGEN), y: Y(y0 + alto), width: 62 * MM, height: alto * MM });

  let y = y0 + 4.6;
  txt(page, String(n), x0, y, fu.cb, 9, t.tinta);
  const nombre = wrap(fu.hb, limpiarTextoPdf(ln.nombre), 16, (w - 6) * MM).slice(0, 2);
  nombre.forEach((s, i) => txt(page, s, x0 + 6, y + i * 6.2, fu.hb, 16, t.tinta));
  y += (nombre.length - 1) * 6.2 + 5.6;
  if (ln.lema) {
    const lema = wrap(fu.hb, limpiarTextoPdf(ln.lema), 10, w * MM).slice(0, 2);
    lema.forEach((s, i) => txt(page, s, x0, y + i * 4.4, fu.hb, 10, t.trazo));
    y += lema.length * 4.4 + 1;
  }
  const altoDatos = casillaDatos(page, l, ln, x0, 0, w, false);
  const yDatos = y0 + alto - altoDatos;
  if (ln.descripcion) {
    const paso = 13.5 * PT;
    const caben = Math.max(0, Math.min(5, Math.floor((yDatos - 2 - y) / paso)));
    const desc = lineasPorFrase(fu.h, limpiarTextoPdf(ln.descripcion), 9.5, w, caben);
    desc.forEach((s, i) => txt(page, s, x0, y + 0.6 + i * paso, fu.h, 9.5, t.tinta));
  }
  casillaDatos(page, l, ln, x0, yDatos, w);
  return y0 + alto;
}

function partidaCompacta(page: PDFPage, l: Lienzo, ln: LineaPropuesta, n: number, y0: number, alto: number, foto: PDFImage | null, maxDesc: number): number {
  const { fu, t } = l;
  if (foto) page.drawImage(foto, { x: X(MARGEN), y: Y(y0 + alto), width: 26 * MM, height: alto * MM });
  const x0 = foto ? MARGEN + 26 + 5 : MARGEN;
  const xDatos = DERECHA - 58;
  const w = xDatos - 3 - x0;

  let y = y0 + 4.2;
  txt(page, String(n), x0, y, fu.cb, 9, t.tinta);
  const nombre = wrap(fu.hb, limpiarTextoPdf(ln.nombre), 11.5, (w - 5) * MM).slice(0, 2);
  nombre.forEach((s, i) => txt(page, s, x0 + 5, y + i * 4.6, fu.hb, 11.5, t.tinta));
  y += (nombre.length - 1) * 4.6 + 4.4;
  if (ln.lema) {
    txt(page, wrap(fu.hb, limpiarTextoPdf(ln.lema), 9, w * MM)[0] ?? "", x0, y, fu.hb, 9, t.trazo);
    y += 4.4;
  }
  if (ln.descripcion) {
    const paso = 12 * PT;
    const caben = Math.max(0, Math.min(maxDesc, Math.floor((y0 + alto - 1 - y) / paso)));
    lineasPorFrase(fu.h, limpiarTextoPdf(ln.descripcion), 8.5, w, caben).forEach((s, i) =>
      txt(page, s, x0, y + i * paso, fu.h, 8.5, t.tinta),
    );
  }
  casillaDatos(page, l, ln, xDatos, y0, 58);
  return y0 + alto;
}

function queIncluye(page: PDFPage, l: Lienzo, y0: number): number {
  const { fu, t } = l;
  const puntos = l.prop.que_incluye.map(limpiarTextoPdf).filter(Boolean);
  if (puntos.length === 0) return y0;
  txt(page, "Qué incluye", MARGEN, y0 + 3.6, fu.hb, 9, t.tinta);
  puntos.forEach((p, i) => {
    const col = i % 2;
    const fila = Math.floor(i / 2);
    const s = wrap(fu.h, `— ${p}`, 9, 90 * MM)[0] ?? "";
    txt(page, s, MARGEN + col * 93, y0 + 8 + fila * 4.2, fu.h, 9, t.tinta);
  });
  return y0 + 8 + Math.ceil(puntos.length / 2) * 4.2;
}
const ALTO_QUE_INCLUYE = (n: number) => (n ? 8 + Math.ceil(n / 2) * 4.2 : 0);

function qrVectorial(page: PDFPage, url: string, x: number, y: number, lado: number, color: RGB): void {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const m = lado / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      let fin = c;
      while (fin + 1 < n && qr.modules.get(r, fin + 1)) fin++;
      // Un poco de solape para que no salgan rayas finas entre módulos.
      caja(page, x + c * m, y + r * m, (fin - c + 1) * m + 0.02, m + 0.02, { relleno: color });
      c = fin + 1;
    }
  }
}

/** Anotación de enlace (acción URI) sobre un rectángulo: el botón se puede pulsar. */
function enlace(page: PDFPage, pdf: PDFDocument, url: string, x: number, y: number, w: number, h: number): void {
  const annot = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [X(x), Y(y + h), X(x + w), Y(y)],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }),
  );
  page.node.addAnnot(annot);
}

const ALTO_CUPON = 26;

function cupon(page: PDFPage, l: Lienzo, y0: number): number {
  const { fu, t, pdf } = l;
  linea(page, MARGEN, y0, DERECHA, y0, 0.6, t.tinta, [3, 2]);
  const y = y0 + 4;
  txt(page, "¿Lo vemos por teléfono?", MARGEN, y + 4.2, fu.hb, 12, t.tinta);
  const frase = hayPrecios(l.prop.lineas, l.conPrecios)
    ? `Pulsad “${ACCION}” en el WhatsApp, o escribidnos, y os llamamos nosotros.`
    : NOTA_SIN_PRECIOS;
  const lineas = wrap(fu.h, frase, 9, 88 * MM).slice(0, 3);
  lineas.forEach((s, i) => txt(page, s, MARGEN, y + 9 + i * 3.9, fu.h, 9, t.tinta));
  const tel = formatearTelefono(l.empresa.telefono);
  if (tel) txt(page, tel, MARGEN, y + 9 + lineas.length * 3.9 + 4.4, fu.cb, 14, t.tinta);

  if (l.waMe) {
    const bx = MARGEN + 92 + 2;
    const by = y + 3;
    caja(page, bx, by, 58, 11, { relleno: t.campo, borde: t.tinta, grosor: 0.6 });
    txt(page, ACCION, bx + 29, by + 7.1, fu.hb, 11, t.sobreCampo, "centro");
    enlace(page, pdf, l.waMe, bx, by, 58, 11);

    const qx = DERECHA - 22;
    qrVectorial(page, l.waMe, qx, y, 22, t.tinta);
    enlace(page, pdf, l.waMe, qx, y, 22, 22);
    txt(page, "o escanead", qx + 11, y + 22 + 2.6, fu.h, 6.5, t.suave, "centro");
  }
  return y0 + ALTO_CUPON;
}

function pie(page: PDFPage, l: Lienzo, y0: number, hoja?: string): number {
  const { fu, t } = l;
  const l1 = limpiarTextoPdf(lineaFiscal(l.empresa));
  const l2 = `Propuesta informativa, sin valor contractual. Generada el ${fechaCorta(l.prop.created_at)}, válida hasta el ${fechaCorta(l.prop.caduca_at)}. Ref. ${l.ref}.`;
  const max = (hoja ? UTIL - 25 : UTIL) * MM;
  const filas = [...wrap(fu.h, l1, 6.5, max), ...wrap(fu.h, l2, 6.5, max)].slice(0, 3);
  filas.forEach((s, i) => txt(page, s, MARGEN, y0 + 3 + i * 3.2, fu.h, 6.5, t.suave));
  if (hoja) txt(page, hoja, DERECHA, y0 + 3, fu.c, 8, t.suave, "der");
  return y0 + 3 + filas.length * 3.2;
}

// -----------------------------------------------------------------------------
// Generador
// -----------------------------------------------------------------------------

export interface PdfGenerado {
  bytes: Uint8Array;
  paginas: number;
}

/**
 * Genera el PDF de una propuesta ya creada. `empresa` se puede pasar si ya
 * está cargada (el enganche del «Sí» la necesita también para el mensaje).
 */
export async function generarPdfPropuesta(companyId: string, prop: FilaPropuesta, empresaDada?: EmpresaPropuesta): Promise<PdfGenerado> {
  if (prop.company_id !== companyId) throw new Error("La propuesta no es de esta empresa.");
  const empresa = empresaDada ?? (await cargarEmpresaPropuesta(companyId));
  if (!empresa) throw new Error("No se encontró la empresa.");

  const paleta = derivarPaletaPropuesta(empresa.primario, empresa.acento);
  const t: Tintas = {
    tinta: aRgb(paleta.tinta),
    suave: aRgb(paleta.tintaSuave),
    velo: aRgb(paleta.velo),
    campo: aRgb(paleta.primarioCampo),
    sobreCampo: aRgb(paleta.sobreCampo),
    // Papel blanco: el trazo de derivarPaleta (medido contra blanco) vale aquí.
    trazo: aRgb(paleta.primarioTrazo),
    filete: aRgb(paleta.filete),
  };

  const pdf = await PDFDocument.create();
  const fu: Fuentes = {
    h: withSanitizer(await pdf.embedFont(StandardFonts.Helvetica)),
    hb: withSanitizer(await pdf.embedFont(StandardFonts.HelveticaBold)),
    c: withSanitizer(await pdf.embedFont(StandardFonts.Courier)),
    cb: withSanitizer(await pdf.embedFont(StandardFonts.CourierBold)),
  };
  const nombre = limpiarTextoPdf(prop.nombre_negocio) || "vuestro negocio";
  pdf.setTitle(`Propuesta para ${nombre}`);
  pdf.setAuthor(limpiarTextoPdf(empresa.nombre));
  pdf.setCreator(limpiarTextoPdf(empresa.nombre));
  pdf.setProducer(limpiarTextoPdf(empresa.nombre));
  pdf.setLanguage("es-ES");

  const lineas = prop.lineas.slice(0, 6);
  const ref = referenciaDe(prop.codigo);
  // Imágenes: logo y fotos ya compuestas en su panel (JPG, sin alfa).
  const [logoB, ...fotosB] = await Promise.all([descargar(empresa.logoUrl), ...lineas.map((x) => descargar(x.imagen_url))]);
  const logo = await incrustar(pdf, await prepararImagen(logoB, { maxPx: 600, recortar: true }));
  const fotos: Array<PDFImage | null> = [];
  for (let i = 0; i < lineas.length; i++) {
    const principal = i === 0;
    const jpg = await fotoEnPanel(fotosB[i] ?? null, principal ? 520 : 220, principal ? 560 : 290, principal ? 42 : 16, paleta.velo);
    fotos.push(jpg ? await pdf.embedJpg(jpg).catch(() => null) : null);
  }

  const l: Lienzo = {
    pdf,
    fu,
    t,
    empresa,
    prop,
    logo,
    waMe: enlaceWaMe(empresa.numeroCaptacion, textoQueMeLlameis(nombre, ref)),
    ref,
    nombre,
    conPrecios: prop.con_precios,
  };

  const dosHojas = lineas.length > 3;
  const p1 = pdf.addPage([ANCHO * MM, ALTO * MM]);
  let y = membrete(p1, l) + 5;
  y = casillas(p1, l, y) + 5;
  y = carta(p1, l, y) + 4;
  const nQue = prop.que_incluye.length;

  // Alturas: se encogen en este orden solo si no cabe (§6.2 y §6.3).
  const enHoja1 = lineas.slice(0, 3);
  const resto = 7 + 3 + (dosHojas ? 0 : 5 + ALTO_CUPON + 5 + 10 + (nQue ? ALTO_QUE_INCLUYE(nQue) + 3 : 0));
  const opciones: Array<[number, number, number]> = [
    [66, 34, 3],
    [66, 30, 2],
    [58, 30, 2],
    [50, 28, 2],
  ];
  let [hP, hC, maxDesc] = opciones[opciones.length - 1]!;
  for (const [a, b, d] of opciones) {
    const total = y + resto + (enHoja1.length ? a : 0) + Math.max(0, enHoja1.length - 1) * (b + 3);
    if (total <= LIMITE) {
      [hP, hC, maxDesc] = [a, b, d];
      break;
    }
  }

  if (lineas.length > 0) {
    y = tituloRelacion(p1, l, y, lineas.length) + 3;
    y = await partidaPrincipal(p1, l, lineas[0]!, 1, y, hP, fotos[0] ?? null);
    for (let i = 1; i < enHoja1.length; i++) {
      linea(p1, MARGEN, y + 1.5, DERECHA, y + 1.5, 0.4, t.filete);
      y = partidaCompacta(p1, l, lineas[i]!, i + 1, y + 3, hC, fotos[i] ?? null, maxDesc);
    }
  }

  if (!dosHojas) {
    if (nQue) y = queIncluye(p1, l, y + 5) - 2;
    y = cupon(p1, l, y + 5);
    pie(p1, l, y + 5);
    return { bytes: await pdf.save(), paginas: 1 };
  }

  // Hoja 1 sin cupón; «sigue en la hoja 2» al pie, a la derecha.
  txt(p1, "sigue en la hoja 2", DERECHA, LIMITE - 5, fu.c, 8, t.suave, "der");
  txt(p1, "hoja 1 de 2", DERECHA, LIMITE - 1.5, fu.c, 8, t.suave, "der");
  const p2 = pdf.addPage([ANCHO * MM, ALTO * MM]);
  y = membreteReducido(p2, l) + 5;
  for (let i = 3; i < lineas.length; i++) {
    if (i > 3) linea(p2, MARGEN, y + 1.5, DERECHA, y + 1.5, 0.4, t.filete);
    y = partidaCompacta(p2, l, lineas[i]!, i + 1, y + (i > 3 ? 3 : 0), 34, fotos[i] ?? null, 3);
  }
  if (nQue) y = queIncluye(p2, l, y + 5) - 2;
  y = cupon(p2, l, y + 5);
  pie(p2, l, y + 5, "hoja 2 de 2");
  return { bytes: await pdf.save(), paginas: 2 };
}

// -----------------------------------------------------------------------------
// Fase 8: PDF de ejemplo para crear la plantilla con cabecera DOCUMENT
// -----------------------------------------------------------------------------

/**
 * Una hoja A4 sencilla que Meta ve al revisar la plantilla. No lleva datos de
 * ningún negocio real (solo el nombre de ejemplo que escribe el admin) ni
 * precios: solo enseña qué tipo de documento se va a mandar.
 */
export async function pdfEjemploPlantilla(empresa: string, negocioEjemplo: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([ANCHO * MM, ALTO * MM]);
  const x = MARGEN * MM;
  const escribir = (texto: string, yMm: number, tam: number, fuente: PDFFont) =>
    p.drawText(limpiarTextoPdf(texto).slice(0, 90), { x, y: (ALTO - yMm) * MM, size: tam, font: fuente, color: rgb(0.1, 0.1, 0.12) });
  escribir(empresa, 30, 12, negrita);
  escribir("Propuesta de equipos", 50, 22, negrita);
  escribir(`Para: ${negocioEjemplo}`, 62, 13, normal);
  escribir("Documento de ejemplo para la revisión de la plantilla.", 80, 11, normal);
  escribir("Cada negocio recibe su propuesta con los equipos de su campaña.", 87, 11, normal);
  pdf.setTitle(limpiarTextoPdf(`Propuesta de equipos · ${empresa}`));
  return pdf.save();
}
