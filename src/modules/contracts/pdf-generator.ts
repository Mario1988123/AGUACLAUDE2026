"use server";

import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { getContract, getContractItems, getContractPayments } from "./actions";

// ============================================================================
// Constantes de diseño
// ============================================================================
const PAGE_W = 595; // A4
const PAGE_H = 842;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Paleta marca AguaClaude (teal)
const TEAL = rgb(20 / 255, 169 / 255, 173 / 255);
const TEAL_DARK = rgb(15 / 255, 130 / 255, 133 / 255);
const TEAL_LIGHT = rgb(0.91, 0.97, 0.97);
const TEXT = rgb(0.13, 0.13, 0.18);
const MUTED = rgb(0.45, 0.48, 0.55);
const BORDER = rgb(0.86, 0.88, 0.93);
const BG_SOFT = rgb(0.97, 0.98, 0.98);
const WHITE = rgb(1, 1, 1);
const SUCCESS = rgb(0.06, 0.55, 0.32);
const SUCCESS_BG = rgb(0.85, 0.96, 0.91);

const PLAN_TITLE = {
  cash: "CONTRATO DE COMPRA",
  rental: "CONTRATO DE ALQUILER",
  renting: "CONTRATO DE RENTING",
} as const;

const PLAN_SUBTITLE = {
  cash: "Compra al contado de los equipos descritos",
  rental: "Cesión en alquiler con cuota mensual",
  // La financiera la asigna admin tras firma (no aparece en el contrato).
  renting: "Renting de los equipos descritos con cuotas mensuales",
} as const;

const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};
const MOMENT_LABEL: Record<string, string> = {
  on_signature: "A la firma",
  on_installation: "En la instalación",
  intermediate: "Intermedio",
  periodic: "Periódico mensual",
};

// ============================================================================
// Helpers PDF
// ============================================================================
interface Doc {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  cursorY: number;
  pageNumber: number;
}

async function newDoc(): Promise<Doc> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  return { pdf, page, font, bold, italic, cursorY: PAGE_H - MARGIN, pageNumber: 1 };
}

function newPage(d: Doc): void {
  d.page = d.pdf.addPage([PAGE_W, PAGE_H]);
  d.cursorY = PAGE_H - MARGIN;
  d.pageNumber += 1;
}

function ensure(d: Doc, needed: number): void {
  if (d.cursorY - needed < 60) newPage(d);
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const paragraphs = text.split(/\n/);
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (cur) out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    if (paragraphs.length > 1) out.push("");
  }
  return out;
}

function fmtEur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

function fmtDateLong(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES");
}

// ============================================================================
// Componentes visuales
// ============================================================================

/**
 * Cabecera con banda teal arriba, datos empresa a la izda y título centrado.
 * SIN watermark superpuesto al título.
 */
function drawHeader(
  d: Doc,
  opts: {
    planType: "cash" | "rental" | "renting";
    refCode: string | null;
    dateLabel: string;
    companyName: string;
    companyTaxId: string | null;
    companyAddress: string | null;
    companyContact: string | null;
  },
): void {
  // Banda teal superior
  d.page.drawRectangle({
    x: 0,
    y: PAGE_H - 12,
    width: PAGE_W,
    height: 12,
    color: TEAL,
  });

  // Empresa arriba izda
  d.page.drawText(opts.companyName.toUpperCase(), {
    x: MARGIN,
    y: PAGE_H - 35,
    size: 13,
    font: d.bold,
    color: TEXT,
  });
  let y = PAGE_H - 50;
  if (opts.companyTaxId) {
    d.page.drawText(`CIF/NIF: ${opts.companyTaxId}`, {
      x: MARGIN,
      y,
      size: 8.5,
      font: d.font,
      color: MUTED,
    });
    y -= 11;
  }
  if (opts.companyAddress) {
    d.page.drawText(opts.companyAddress, {
      x: MARGIN,
      y,
      size: 8.5,
      font: d.font,
      color: MUTED,
    });
    y -= 11;
  }
  if (opts.companyContact) {
    d.page.drawText(opts.companyContact, {
      x: MARGIN,
      y,
      size: 8.5,
      font: d.font,
      color: MUTED,
    });
  }

  // Ref + fecha arriba derecha
  if (opts.refCode) {
    const refTxt = `Ref. ${opts.refCode}`;
    const w = d.bold.widthOfTextAtSize(refTxt, 10);
    d.page.drawText(refTxt, {
      x: PAGE_W - MARGIN - w,
      y: PAGE_H - 35,
      size: 10,
      font: d.bold,
      color: TEAL_DARK,
    });
  }
  const dateTxt = opts.dateLabel;
  const dw = d.font.widthOfTextAtSize(dateTxt, 9);
  d.page.drawText(dateTxt, {
    x: PAGE_W - MARGIN - dw,
    y: PAGE_H - 50,
    size: 9,
    font: d.font,
    color: MUTED,
  });

  // Título grande centrado
  const title = PLAN_TITLE[opts.planType];
  const subtitle = PLAN_SUBTITLE[opts.planType];
  const titleSize = 22;
  const tw = d.bold.widthOfTextAtSize(title, titleSize);
  const titleY = PAGE_H - 110;
  d.page.drawText(title, {
    x: PAGE_W / 2 - tw / 2,
    y: titleY,
    size: titleSize,
    font: d.bold,
    color: TEAL_DARK,
  });
  // Línea decorativa bajo el título
  d.page.drawRectangle({
    x: PAGE_W / 2 - 30,
    y: titleY - 8,
    width: 60,
    height: 3,
    color: TEAL,
  });
  // Subtítulo
  const sw = d.italic.widthOfTextAtSize(subtitle, 10);
  d.page.drawText(subtitle, {
    x: PAGE_W / 2 - sw / 2,
    y: titleY - 24,
    size: 10,
    font: d.italic,
    color: MUTED,
  });

  d.cursorY = titleY - 50;
}

/**
 * Tarjeta del cliente con borde teal y datos clave.
 */
function drawCustomerCard(
  d: Doc,
  customer: {
    name: string;
    taxId: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  },
): void {
  const padding = 14;
  const lineH = 14;
  const rows: Array<[string, string]> = [
    ["Nombre", customer.name],
    ["DNI/CIF", customer.taxId ?? "—"],
    ["Dirección", customer.address ?? "—"],
  ];
  if (customer.phone) rows.push(["Teléfono", customer.phone]);
  if (customer.email) rows.push(["Email", customer.email]);
  const cardH = 30 + rows.length * lineH + padding;
  ensure(d, cardH + 10);
  const top = d.cursorY;

  // Fondo
  d.page.drawRectangle({
    x: MARGIN,
    y: top - cardH,
    width: CONTENT_W,
    height: cardH,
    color: TEAL_LIGHT,
    borderColor: TEAL,
    borderWidth: 0.6,
  });
  // Header
  d.page.drawText("DATOS DEL CLIENTE", {
    x: MARGIN + padding,
    y: top - 18,
    size: 9.5,
    font: d.bold,
    color: TEAL_DARK,
  });
  // Filas
  rows.forEach((r, i) => {
    const y = top - 35 - i * lineH;
    d.page.drawText(`${r[0]}:`, {
      x: MARGIN + padding,
      y,
      size: 9,
      font: d.font,
      color: MUTED,
    });
    const lines = wrap(d.bold, r[1], 9.5, CONTENT_W - padding * 2 - 80);
    d.page.drawText(lines[0] ?? "—", {
      x: MARGIN + padding + 80,
      y,
      size: 9.5,
      font: d.bold,
      color: TEXT,
    });
  });
  d.cursorY = top - cardH - 16;
}

/**
 * Tiles del resumen del contrato (tipo / cuota / total / duración).
 */
function drawSummaryTiles(
  d: Doc,
  tiles: Array<{ label: string; value: string; sub?: string }>,
): void {
  const perRow = Math.min(4, tiles.length);
  const gap = 10;
  const tileW = (CONTENT_W - gap * (perRow - 1)) / perRow;
  const tileH = 60;
  ensure(d, tileH + 10);
  const top = d.cursorY;
  tiles.forEach((t, i) => {
    const x = MARGIN + i * (tileW + gap);
    // Sombra ligera
    d.page.drawRectangle({
      x,
      y: top - tileH,
      width: tileW,
      height: tileH,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    // Banda izquierda colorida
    d.page.drawRectangle({
      x,
      y: top - tileH,
      width: 4,
      height: tileH,
      color: TEAL,
    });
    // Label
    d.page.drawText(t.label.toUpperCase(), {
      x: x + 12,
      y: top - 18,
      size: 7.5,
      font: d.bold,
      color: TEAL_DARK,
    });
    // Value
    const valSize = t.value.length > 10 ? 13 : 16;
    d.page.drawText(t.value, {
      x: x + 12,
      y: top - 38,
      size: valSize,
      font: d.bold,
      color: TEXT,
    });
    // Sub
    if (t.sub) {
      d.page.drawText(t.sub, {
        x: x + 12,
        y: top - 52,
        size: 7.5,
        font: d.font,
        color: MUTED,
      });
    }
  });
  d.cursorY = top - tileH - 16;
}

/**
 * Bloque destacado con título + body o filas KV.
 */
function drawCallout(
  d: Doc,
  opts: {
    title: string;
    tone?: "info" | "success";
    rows?: Array<[string, string]>;
    body?: string;
    icon?: string;
  },
): void {
  const padding = 14;
  const lineH = 14;
  const bg = opts.tone === "success" ? SUCCESS_BG : TEAL_LIGHT;
  const border = opts.tone === "success" ? SUCCESS : TEAL;
  const titleColor = opts.tone === "success" ? SUCCESS : TEAL_DARK;
  const rowsCount = opts.rows?.length ?? 0;
  const bodyLines = opts.body
    ? wrap(d.font, opts.body, 10, CONTENT_W - padding * 2)
    : [];
  const blockH = 28 + Math.max(rowsCount * lineH, bodyLines.length * 13) + padding;
  ensure(d, blockH + 10);
  const top = d.cursorY;

  d.page.drawRectangle({
    x: MARGIN,
    y: top - blockH,
    width: CONTENT_W,
    height: blockH,
    color: bg,
    borderColor: border,
    borderWidth: 0.6,
  });
  d.page.drawText(`${opts.icon ?? ""} ${opts.title}`.trim(), {
    x: MARGIN + padding,
    y: top - 18,
    size: 10,
    font: d.bold,
    color: titleColor,
  });

  if (opts.rows && opts.rows.length > 0) {
    opts.rows.forEach((r, i) => {
      const y = top - 35 - i * lineH;
      d.page.drawText(`${r[0]}:`, {
        x: MARGIN + padding,
        y,
        size: 9,
        font: d.font,
        color: MUTED,
      });
      d.page.drawText(r[1], {
        x: MARGIN + padding + 90,
        y,
        size: 10,
        font: d.bold,
        color: TEXT,
      });
    });
  }
  if (opts.body) {
    bodyLines.forEach((ln, i) => {
      d.page.drawText(ln, {
        x: MARGIN + padding,
        y: top - 32 - i * 13,
        size: 10,
        font: d.font,
        color: TEXT,
      });
    });
  }
  d.cursorY = top - blockH - 14;
}

/**
 * Sección con título grande + línea decorativa.
 *
 * Decisión usuario 2026-05-19: cada sección empieza en página nueva
 * (excepto la primera). Así el documento es más legible: no quedan
 * encabezados a mitad de página y los términos siempre arrancan en una
 * página propia.
 */
function drawSection(d: Doc, label: string): void {
  // Si NO es la primera sección del documento, salto de página.
  // Detectamos "primera sección" porque cursorY ≈ top.
  const isTop = d.cursorY > PAGE_H - MARGIN - 5;
  if (!isTop) {
    newPage(d);
  }
  d.cursorY -= 14;
  d.page.drawText(label.toUpperCase(), {
    x: MARGIN,
    y: d.cursorY,
    size: 11,
    font: d.bold,
    color: TEAL_DARK,
  });
  d.cursorY -= 6;
  d.page.drawLine({
    start: { x: MARGIN, y: d.cursorY },
    end: { x: MARGIN + 50, y: d.cursorY },
    thickness: 2,
    color: TEAL,
  });
  d.page.drawLine({
    start: { x: MARGIN + 50, y: d.cursorY },
    end: { x: PAGE_W - MARGIN, y: d.cursorY },
    thickness: 0.5,
    color: BORDER,
  });
  d.cursorY -= 14;
}

/**
 * Equipos contratados como tarjetas individuales (más vistoso que tabla).
 */
function drawEquipmentCards(
  d: Doc,
  items: Array<{
    product: string;
    quantity: number;
    unitPriceCents: number;
    isMonthly: boolean;
    monthlyCents?: number | null;
    monthsIncluded?: number | null;
  }>,
): void {
  for (const it of items) {
    ensure(d, 50);
    const cardH = 44;
    const top = d.cursorY;

    // Fondo
    d.page.drawRectangle({
      x: MARGIN,
      y: top - cardH,
      width: CONTENT_W,
      height: cardH,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    // Banda teal lateral
    d.page.drawRectangle({
      x: MARGIN,
      y: top - cardH,
      width: 4,
      height: cardH,
      color: TEAL,
    });
    // Cantidad como badge
    const qtyTxt = `×${it.quantity}`;
    const qw = d.bold.widthOfTextAtSize(qtyTxt, 13);
    d.page.drawRectangle({
      x: MARGIN + 12,
      y: top - 36,
      width: qw + 14,
      height: 22,
      color: TEAL_DARK,
    });
    d.page.drawText(qtyTxt, {
      x: MARGIN + 19,
      y: top - 30,
      size: 13,
      font: d.bold,
      color: WHITE,
    });
    // Nombre del producto
    const nameLines = wrap(d.bold, it.product, 11, CONTENT_W - 200);
    d.page.drawText(nameLines[0] ?? "—", {
      x: MARGIN + 12 + qw + 26,
      y: top - 22,
      size: 11,
      font: d.bold,
      color: TEXT,
    });
    if (nameLines[1]) {
      d.page.drawText(nameLines[1], {
        x: MARGIN + 12 + qw + 26,
        y: top - 35,
        size: 9,
        font: d.font,
        color: MUTED,
      });
    }
    // Precio unitario y subtotal a la derecha
    const subtotal = it.unitPriceCents * it.quantity;
    const priceText = it.isMonthly
      ? `${fmtEur(it.unitPriceCents)} /mes`
      : fmtEur(it.unitPriceCents);
    const pw = d.font.widthOfTextAtSize(priceText, 9);
    d.page.drawText(priceText, {
      x: PAGE_W - MARGIN - 12 - pw,
      y: top - 22,
      size: 9,
      font: d.font,
      color: MUTED,
    });
    const subtotalText = it.isMonthly
      ? `${fmtEur(subtotal)} /mes`
      : fmtEur(subtotal);
    const sw = d.bold.widthOfTextAtSize(subtotalText, 12);
    d.page.drawText(subtotalText, {
      x: PAGE_W - MARGIN - 12 - sw,
      y: top - 36,
      size: 12,
      font: d.bold,
      color: TEAL_DARK,
    });

    d.cursorY = top - cardH - 8;
  }
}

/**
 * Tabla simple del plan de pagos.
 */
function drawPaymentsTable(
  d: Doc,
  rows: Array<{
    concept: string;
    moment: string;
    method: string;
    amountCents: number;
  }>,
): void {
  const cols = [220, 110, 110, 75]; // concept | moment | method | amount
  const headerH = 22;
  const rowH = 20;
  ensure(d, headerH + rows.length * rowH + 10);

  // Header
  d.cursorY -= headerH;
  const headerY = d.cursorY;
  d.page.drawRectangle({
    x: MARGIN,
    y: headerY - 4,
    width: CONTENT_W,
    height: headerH,
    color: TEAL_DARK,
  });
  let x = MARGIN + 10;
  ["CONCEPTO", "MOMENTO", "MÉTODO", "IMPORTE"].forEach((h, i) => {
    const align = i === 0 ? "left" : i === 3 ? "right" : "left";
    if (align === "left") {
      d.page.drawText(h, {
        x,
        y: headerY + 6,
        size: 8,
        font: d.bold,
        color: WHITE,
      });
    } else {
      const w = d.bold.widthOfTextAtSize(h, 8);
      d.page.drawText(h, {
        x: x + cols[i]! - 10 - w,
        y: headerY + 6,
        size: 8,
        font: d.bold,
        color: WHITE,
      });
    }
    x += cols[i]!;
  });

  // Rows
  rows.forEach((r, idx) => {
    ensure(d, rowH);
    d.cursorY -= rowH;
    const y = d.cursorY;
    if (idx % 2 === 1) {
      d.page.drawRectangle({
        x: MARGIN,
        y: y - 2,
        width: CONTENT_W,
        height: rowH,
        color: BG_SOFT,
      });
    }
    let cx = MARGIN + 10;
    const cells = [
      r.concept,
      MOMENT_LABEL[r.moment] ?? r.moment,
      METHOD_LABEL[r.method] ?? r.method,
      fmtEur(r.amountCents),
    ];
    cells.forEach((c, i) => {
      const align = i === 3 ? "right" : "left";
      const fontUse = i === 3 ? d.bold : d.font;
      const colorUse = i === 3 ? TEAL_DARK : TEXT;
      if (align === "left") {
        d.page.drawText(c, {
          x: cx,
          y: y + 6,
          size: 9.5,
          font: fontUse,
          color: colorUse,
        });
      } else {
        const w = fontUse.widthOfTextAtSize(c, 9.5);
        d.page.drawText(c, {
          x: cx + cols[i]! - 10 - w,
          y: y + 6,
          size: 9.5,
          font: fontUse,
          color: colorUse,
        });
      }
      cx += cols[i]!;
    });
    d.page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end: { x: PAGE_W - MARGIN, y: y - 2 },
      thickness: 0.4,
      color: BORDER,
    });
  });
  d.cursorY -= 10;
}

/**
 * Cláusulas: numeradas, con título destacado y body justificado.
 */
function drawClauses(
  d: Doc,
  clauses: Array<{ title: string; body: string }>,
): void {
  clauses.forEach((c, i) => {
    ensure(d, 50);
    d.cursorY -= 16;
    // Número en círculo teal
    const numTxt = String(i + 1);
    const numW = d.bold.widthOfTextAtSize(numTxt, 11);
    d.page.drawCircle({
      x: MARGIN + 10,
      y: d.cursorY + 4,
      size: 11,
      color: TEAL_DARK,
    });
    d.page.drawText(numTxt, {
      x: MARGIN + 10 - numW / 2,
      y: d.cursorY + 1,
      size: 10,
      font: d.bold,
      color: WHITE,
    });
    // Título
    d.page.drawText(c.title, {
      x: MARGIN + 28,
      y: d.cursorY,
      size: 10.5,
      font: d.bold,
      color: TEXT,
    });
    d.cursorY -= 14;
    // Body
    const lines = wrap(d.font, c.body, 9.5, CONTENT_W - 28);
    for (const ln of lines) {
      ensure(d, 13);
      d.page.drawText(ln, {
        x: MARGIN + 28,
        y: d.cursorY,
        size: 9.5,
        font: d.font,
        color: TEXT,
      });
      d.cursorY -= 12;
    }
    d.cursorY -= 8;
  });
}

/**
 * Bloque firmas: dos columnas grandes con imagen de firma embebida.
 */
function drawSignatures(
  d: Doc,
  opts: {
    company: {
      name: string;
      signatureImage?: PDFImage | null;
      signedDate: string | null;
    };
    customer: {
      name: string;
      taxId: string | null;
      signatureImage?: PDFImage | null;
      signedDate: string | null;
    };
  },
): void {
  const colW = (CONTENT_W - 20) / 2;
  const blockH = 130;
  ensure(d, blockH + 20);
  d.cursorY -= 10;
  const top = d.cursorY;

  function column(
    x: number,
    title: string,
    name: string,
    extra: string[],
    img?: PDFImage | null,
    signedDate?: string | null,
  ) {
    // Marco
    d.page.drawRectangle({
      x,
      y: top - blockH,
      width: colW,
      height: blockH,
      color: BG_SOFT,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    // Header
    d.page.drawText(title, {
      x: x + 14,
      y: top - 18,
      size: 9,
      font: d.bold,
      color: TEAL_DARK,
    });
    d.page.drawLine({
      start: { x: x + 14, y: top - 24 },
      end: { x: x + colW - 14, y: top - 24 },
      thickness: 0.6,
      color: TEAL,
    });

    // Imagen firma o placeholder
    const imgArea = {
      x: x + 14,
      y: top - 90,
      width: colW - 28,
      height: 55,
    };
    if (img) {
      const ratio = img.width / img.height;
      let w = imgArea.width;
      let h = w / ratio;
      if (h > imgArea.height) {
        h = imgArea.height;
        w = h * ratio;
      }
      d.page.drawImage(img, {
        x: imgArea.x + (imgArea.width - w) / 2,
        y: imgArea.y + (imgArea.height - h) / 2,
        width: w,
        height: h,
      });
    } else {
      // Placeholder suave
      d.page.drawText("— pendiente de firma —", {
        x: x + colW / 2 - d.italic.widthOfTextAtSize("— pendiente de firma —", 9) / 2,
        y: top - 60,
        size: 9,
        font: d.italic,
        color: MUTED,
      });
    }

    // Línea de firma
    d.page.drawLine({
      start: { x: x + 30, y: top - 95 },
      end: { x: x + colW - 30, y: top - 95 },
      thickness: 0.8,
      color: TEXT,
    });
    // Nombre
    const nw = d.bold.widthOfTextAtSize(name, 10);
    d.page.drawText(name, {
      x: x + colW / 2 - nw / 2,
      y: top - 108,
      size: 10,
      font: d.bold,
      color: TEXT,
    });
    // Extra (DNI, fecha)
    const allExtras = [...extra];
    if (signedDate) allExtras.push(`Firmado el ${signedDate}`);
    allExtras.forEach((e, i) => {
      const ew = d.font.widthOfTextAtSize(e, 8);
      d.page.drawText(e, {
        x: x + colW / 2 - ew / 2,
        y: top - 120 - i * 10,
        size: 8,
        font: d.font,
        color: MUTED,
      });
    });
  }

  column(MARGIN, "POR LA EMPRESA", opts.company.name, [], opts.company.signatureImage, opts.company.signedDate);
  const custExtras: string[] = [];
  if (opts.customer.taxId) custExtras.push(`DNI/CIF: ${opts.customer.taxId}`);
  column(
    MARGIN + colW + 20,
    "EL CLIENTE",
    opts.customer.name,
    custExtras,
    opts.customer.signatureImage,
    opts.customer.signedDate,
  );

  d.cursorY = top - blockH - 14;
}

/**
 * Marca "NO VÁLIDO" diagonal en cada página. Se aplica sobre cualquier
 * contrato que no esté legalmente firmado y completo:
 *   - status = draft, pending_data, pending_signature
 *   - sin signed_at
 *   - falta IBAN real (has_provisional_data)
 *
 * Color rojo muy translúcido para no estorbar lectura pero dejar claro
 * que el documento no es definitivo.
 */
function drawWatermark(d: Doc, label: string): void {
  const pages = d.pdf.getPages();
  pages.forEach((p) => {
    const size = 80;
    const text = label.toUpperCase();
    const w = d.bold.widthOfTextAtSize(text, size);
    p.drawText(text, {
      x: PAGE_W / 2 - w / 2,
      y: PAGE_H / 2 - size / 2 + 200,
      size,
      font: d.bold,
      color: rgb(0.9, 0.2, 0.2),
      opacity: 0.18,
      rotate: degrees(35),
    });
    // Segunda copia más abajo para mayor visibilidad
    p.drawText(text, {
      x: PAGE_W / 2 - w / 2,
      y: PAGE_H / 2 - size / 2 - 200,
      size,
      font: d.bold,
      color: rgb(0.9, 0.2, 0.2),
      opacity: 0.18,
      rotate: degrees(35),
    });
  });
}

/**
 * Footer común a todas las páginas.
 */
function drawFooters(
  d: Doc,
  opts: {
    companyName: string;
    contractRef: string;
    generatedAt: string;
    signedAt: string | null;
  },
): void {
  const pages = d.pdf.getPages();
  pages.forEach((p, idx) => {
    // Línea fina arriba del footer
    p.drawLine({
      start: { x: MARGIN, y: 38 },
      end: { x: PAGE_W - MARGIN, y: 38 },
      thickness: 0.3,
      color: BORDER,
    });
    // Empresa
    p.drawText(opts.companyName, {
      x: MARGIN,
      y: 24,
      size: 7.5,
      font: d.bold,
      color: MUTED,
    });
    // Ref centrado
    const center = `Contrato ${opts.contractRef}`;
    const cw = d.font.widthOfTextAtSize(center, 7.5);
    p.drawText(center, {
      x: PAGE_W / 2 - cw / 2,
      y: 24,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
    // Página
    const pageTxt = `Pág. ${idx + 1} / ${pages.length}`;
    const pw = d.font.widthOfTextAtSize(pageTxt, 7.5);
    p.drawText(pageTxt, {
      x: PAGE_W - MARGIN - pw,
      y: 24,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
    // Estado: sólo en footer (NO superpuesto al título)
    if (opts.signedAt) {
      const stamp = `Documento firmado el ${opts.signedAt}`;
      const sw = d.bold.widthOfTextAtSize(stamp, 7.5);
      p.drawText(stamp, {
        x: PAGE_W / 2 - sw / 2,
        y: 13,
        size: 7.5,
        font: d.bold,
        color: SUCCESS,
      });
    } else {
      const stamp = `Generado el ${opts.generatedAt}`;
      const sw = d.font.widthOfTextAtSize(stamp, 7);
      p.drawText(stamp, {
        x: PAGE_W / 2 - sw / 2,
        y: 13,
        size: 7,
        font: d.font,
        color: MUTED,
      });
    }
  });
}

// ============================================================================
// Helpers para datos
// ============================================================================

function partyName(p: {
  party_kind?: "individual" | "company" | null;
  legal_name?: string | null;
  trade_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (p.party_kind === "company") return p.trade_name || p.legal_name || "—";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
}

function addressOneLine(a: {
  street_type?: string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  province?: string | null;
} | null): string {
  if (!a) return "—";
  const parts: string[] = [];
  if (a.street_type || a.street) {
    parts.push(
      `${a.street_type ? a.street_type + " " : ""}${a.street ?? ""}${
        a.street_number ? " " + a.street_number : ""
      }`.trim(),
    );
  }
  if (a.postal_code || a.city) {
    parts.push(`${a.postal_code ?? ""} ${a.city ?? ""}`.trim());
  }
  if (a.province) parts.push(a.province);
  return parts.filter(Boolean).join(", ");
}

/** Decodifica base64 (con o sin prefijo data:) y devuelve los bytes. */
function decodeBase64(input: string): Uint8Array | null {
  try {
    const m = input.match(/^data:[^;]+;base64,(.+)$/);
    const b64 = m ? m[1] : input;
    if (!b64) return null;
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Intenta embeber una firma. Soporta tanto data URL (base64 inline) como
 *  storage path. Se prioriza data_url porque es lo que actualmente guarda
 *  saveContractSignatureAction. */
async function embedSignatureImage(
  pdf: PDFDocument,
  opts: { dataUrl: string | null; storagePath: string | null },
): Promise<PDFImage | null> {
  // 1) Data URL (lo más rápido — sin red ni storage)
  if (opts.dataUrl) {
    const bytes = decodeBase64(opts.dataUrl);
    if (bytes && bytes.length > 0) {
      try {
        return await pdf.embedPng(bytes);
      } catch {
        try {
          return await pdf.embedJpg(bytes);
        } catch {
          /* fallthrough a storage */
        }
      }
    }
  }
  // 2) Storage path (legacy)
  if (opts.storagePath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const buckets = ["contract-signatures", "signatures", "documents"];
      for (const bucket of buckets) {
        const { data, error } = await admin.storage
          .from(bucket)
          .download(opts.storagePath);
        if (error || !data) continue;
        const ab = await (data as Blob).arrayBuffer();
        try {
          return await pdf.embedPng(new Uint8Array(ab));
        } catch {
          try {
            return await pdf.embedJpg(new Uint8Array(ab));
          } catch {
            continue;
          }
        }
      }
    } catch (e) {
      console.error("[embedSignatureImage] storage failed:", e);
    }
  }
  return null;
}

// ============================================================================
// Generador principal
// ============================================================================

export async function generateContractPdf(contractId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  const [contract, items, payments] = await Promise.all([
    getContract(contractId),
    getContractItems(contractId),
    getContractPayments(contractId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const [{ data: company }, { data: companySettings }, { data: customer }] = await Promise.all([
    supabase
      .from("companies")
      .select("legal_name, trade_name, tax_id")
      .eq("id", session.company_id)
      .single(),
    supabase
      .from("company_settings")
      .select(
        "contact_email, contact_phone, fiscal_address, fiscal_postal_code, fiscal_city, fiscal_legal_name, fiscal_tax_id",
      )
      .eq("company_id", session.company_id)
      .maybeSingle(),
    supabase
      .from("customers")
      .select(
        "party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
      )
      .eq("id", contract.customer_id)
      .single(),
  ]);

  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const cs = (companySettings ?? {}) as {
    contact_email?: string | null;
    contact_phone?: string | null;
    fiscal_address?: string | null;
    fiscal_postal_code?: string | null;
    fiscal_city?: string | null;
    fiscal_legal_name?: string | null;
    fiscal_tax_id?: string | null;
  };
  const cu = (customer ?? {}) as {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tax_id?: string | null;
    email?: string | null;
    phone_primary?: string | null;
  };

  // Direcciones del cliente
  const { data: addresses } = await supabase
    .from("addresses")
    .select(
      "kind, is_primary, street_type, street, street_number, postal_code, city, province",
    )
    .eq("customer_id", contract.customer_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addrList = (addresses ?? []) as Array<any>;
  const installAddr = addrList.find((a) => a.kind === "installation") ?? addrList[0] ?? null;
  const installAddrLine = addressOneLine(installAddr);
  const customerAddrLine = addressOneLine(addrList[0] ?? null);

  // Banco
  const { data: bank } = await supabase
    .from("customer_bank_accounts")
    .select("iban, account_holder_name")
    .eq("customer_id", contract.customer_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ibanData = bank as { iban: string | null; account_holder_name: string | null } | null;

  // Cláusulas: snapshot o templates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrAny = contract as any;
  const snapshotClauses = (ctrAny.clauses_snapshot ?? []) as Array<{
    title: string;
    body: string;
  }>;
  let clauses: Array<{ title: string; body: string }> = snapshotClauses;
  if (clauses.length === 0) {
    const { data: tpls } = await supabase
      .from("contract_clause_templates")
      .select("title, body, display_order")
      .eq("company_id", session.company_id)
      .eq("plan_type", contract.plan_type)
      .eq("is_active", true)
      .order("display_order");
    clauses = ((tpls ?? []) as Array<{ title: string; body: string }>).map((t) => ({
      title: t.title,
      body: t.body,
    }));
  }

  // Firmas — leemos signature_data_url (lo que actualmente guarda
  // saveContractSignatureAction) y signature_image_path como fallback
  // para firmas antiguas que fueran a storage. SELECT con fallback
  // defensivo por si data_url no está aún en el cache.
  type SigRow = {
    signer_role: "customer" | "representative";
    signer_name: string;
    signer_tax_id: string | null;
    signature_image_path: string | null;
    signature_data_url: string | null;
    signed_at: string;
  };
  let sigsRes = await supabase
    .from("contract_signatures")
    .select(
      "signer_role, signer_name, signer_tax_id, signature_image_path, signature_data_url, signed_at",
    )
    .eq("contract_id", contractId)
    .order("signed_at", { ascending: false });
  if (
    sigsRes.error &&
    /signature_data_url|schema cache|Could not find/i.test(
      sigsRes.error.message ?? "",
    )
  ) {
    sigsRes = await supabase
      .from("contract_signatures")
      .select("signer_role, signer_name, signer_tax_id, signature_image_path, signed_at")
      .eq("contract_id", contractId)
      .order("signed_at", { ascending: false });
  }
  const sigs = (sigsRes.data ?? []) as SigRow[];
  const repSig = sigs.find((s) => s.signer_role === "representative");
  const custSig = sigs.find((s) => s.signer_role === "customer");

  const doc = await newDoc();
  const today = new Date();

  const repSigImage = repSig
    ? await embedSignatureImage(doc.pdf, {
        dataUrl: repSig.signature_data_url ?? null,
        storagePath: repSig.signature_image_path ?? null,
      })
    : null;
  const custSigImage = custSig
    ? await embedSignatureImage(doc.pdf, {
        dataUrl: custSig.signature_data_url ?? null,
        storagePath: custSig.signature_image_path ?? null,
      })
    : null;

  // ---------- HEADER ----------
  const companyDisplay = co.trade_name || co.legal_name || cs.fiscal_legal_name || "Empresa";
  const companyTaxId = co.tax_id ?? cs.fiscal_tax_id ?? null;
  const companyAddress = [cs.fiscal_address, cs.fiscal_postal_code, cs.fiscal_city]
    .filter(Boolean)
    .join(", ") || null;
  const companyContact = [cs.contact_phone, cs.contact_email].filter(Boolean).join(" · ") || null;

  drawHeader(doc, {
    planType: contract.plan_type,
    refCode: contract.reference_code ?? null,
    dateLabel: fmtDateLong(contract.signed_at ?? contract.created_at ?? today),
    companyName: companyDisplay,
    companyTaxId,
    companyAddress,
    companyContact,
  });

  // ---------- DATOS CLIENTE ----------
  drawCustomerCard(doc, {
    name: partyName(cu),
    taxId: cu.tax_id ?? null,
    address: customerAddrLine !== "—" ? customerAddrLine : null,
    phone: cu.phone_primary ?? null,
    email: cu.email ?? null,
  });

  // ---------- TILES RESUMEN ----------
  const tiles: Array<{ label: string; value: string; sub?: string }> = [];
  if (contract.monthly_cents) {
    tiles.push({
      label: "CUOTA MENSUAL",
      value: fmtEur(contract.monthly_cents),
      sub: "IVA incluido",
    });
  } else {
    tiles.push({
      label: "PRECIO TOTAL",
      value: fmtEur(contract.total_cash_cents),
      sub: "IVA incluido",
    });
  }
  if (contract.duration_months) {
    tiles.push({
      label: "DURACIÓN",
      value: String(contract.duration_months),
      sub: contract.duration_months === 1 ? "mes" : "meses",
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depositCents = (contract as any).deposit_cents as number | null | undefined;
  if (depositCents != null && depositCents > 0) {
    tiles.push({ label: "FIANZA", value: fmtEur(depositCents) });
  }
  // Total contrato (suma cuotas si rental/renting)
  if (contract.monthly_cents && contract.duration_months) {
    tiles.push({
      label: "TOTAL CONTRATO",
      value: fmtEur(contract.monthly_cents * contract.duration_months),
      sub: `${contract.duration_months} cuotas`,
    });
  }
  drawSummaryTiles(doc, tiles);

  // ---------- DIRECCIÓN INSTALACIÓN ----------
  // (sin emojis: pdf-lib StandardFonts solo soporta WinAnsi, no Unicode emoji)
  if (installAddrLine !== "—") {
    drawCallout(doc, {
      title: "DIRECCIÓN DE INSTALACIÓN",
      tone: "info",
      body: installAddrLine,
    });
  }

  // ---------- DATOS BANCARIOS (rental/renting) ----------
  if (
    ibanData &&
    (contract.plan_type === "rental" || contract.plan_type === "renting")
  ) {
    drawCallout(doc, {
      title: "DOMICILIACIÓN BANCARIA",
      tone: "success",
      rows: [
        ["IBAN", ibanData.iban || "ES00"],
        ["Titular", ibanData.account_holder_name || partyName(cu)],
      ],
    });
  }

  // ---------- EQUIPOS ----------
  drawSection(doc, "EQUIPOS CONTRATADOS");
  drawEquipmentCards(
    doc,
    items.map((it) => ({
      product: it.product_name_snapshot,
      quantity: it.quantity,
      unitPriceCents: it.unit_price_cents,
      isMonthly: contract.plan_type !== "cash",
    })),
  );

  // ---------- PLAN DE PAGOS ----------
  if (payments.length > 0) {
    drawSection(doc, "PLAN DE PAGOS");
    drawPaymentsTable(
      doc,
      payments.map((p) => ({
        concept: p.concept,
        moment: p.moment,
        method: p.method,
        amountCents: p.amount_cents,
      })),
    );
  }

  // ---------- CLÁUSULAS ----------
  if (clauses.length > 0) {
    drawSection(doc, "TÉRMINOS Y CONDICIONES");
    drawClauses(doc, clauses);
  }

  // ---------- FIRMAS ----------
  drawSection(doc, "FIRMAS");
  drawSignatures(doc, {
    company: {
      name: repSig?.signer_name ?? companyDisplay,
      signatureImage: repSigImage,
      signedDate: repSig ? fmtDateShort(repSig.signed_at) : null,
    },
    customer: {
      name: custSig?.signer_name ?? partyName(cu),
      taxId: custSig?.signer_tax_id ?? cu.tax_id ?? null,
      signatureImage: custSigImage,
      signedDate: custSig ? fmtDateShort(custSig.signed_at) : null,
    },
  });

  // ---------- FOOTER ----------
  drawFooters(doc, {
    companyName: companyDisplay,
    contractRef: contract.reference_code ?? `#${contract.id.slice(0, 8)}`,
    generatedAt: fmtDateShort(today),
    signedAt: contract.signed_at ? fmtDateShort(contract.signed_at) : null,
  });

  // ---------- WATERMARK NO VÁLIDO ----------
  // Cualquier contrato que no esté firmado y completo recibe marca de
  // agua para evitar que se confunda un borrador o un firmado sin IBAN
  // con un contrato definitivo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrFull = contract as any;
  const isProvisional = ctrFull?.has_provisional_data === true;
  const notFinalStatuses = ["draft", "pending_data", "pending_signature"];
  const isNotFinal =
    !contract.signed_at ||
    notFinalStatuses.includes(contract.status) ||
    isProvisional;
  if (isNotFinal) {
    let label = "BORRADOR · NO VÁLIDO";
    if (contract.status === "pending_data" || isProvisional) {
      label = "FALTAN DATOS · NO VÁLIDO";
    } else if (contract.status === "pending_signature") {
      label = "PENDIENTE FIRMA · NO VÁLIDO";
    }
    drawWatermark(doc, label);
  }

  return await doc.pdf.save();
}
