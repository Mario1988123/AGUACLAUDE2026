import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

/**
 * Helpers PDF estilo DashStack. Layout en cards verde/teal, watermark de
 * estado tipo bubble, footer fino con metadatos. Reusable para contrato y
 * propuesta — sólo cambia el título y los datos.
 */

export const TEAL = rgb(20 / 255, 169 / 255, 173 / 255);
export const TEXT = rgb(0.13, 0.13, 0.18);
export const MUTED = rgb(0.45, 0.48, 0.55);
export const BORDER = rgb(0.86, 0.88, 0.93);
export const BG = rgb(0.96, 0.97, 0.98);
export const WHITE = rgb(1, 1, 1);
export const SUCCESS_BG = rgb(0.85, 0.96, 0.91);
export const SUCCESS_TXT = rgb(0.06, 0.55, 0.32);
export const WARN_BG = rgb(1.0, 0.95, 0.78);
export const WARN_TXT = rgb(0.6, 0.4, 0.0);
export const DRAFT_BG = rgb(0.92, 0.93, 0.96);
export const DRAFT_TXT = rgb(0.45, 0.48, 0.55);

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

export interface DashDoc {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  cursorY: number;
}

export async function newDashDoc(): Promise<DashDoc> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  return { pdf, page, font, bold, cursorY: PAGE_H - MARGIN };
}

function newPage(d: DashDoc): void {
  d.page = d.pdf.addPage([PAGE_W, PAGE_H]);
  d.cursorY = PAGE_H - MARGIN;
}

function ensure(d: DashDoc, needed: number): void {
  if (d.cursorY - needed < 60) newPage(d);
}

export function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length === 0 ? [""] : lines;
}

/**
 * Cabecera estilo DashStack: empresa a la izda + título grande TEAL a la derecha
 * con watermark del estado pegado (tipo bubble: FIRMADO verde, BORRADOR gris,
 * PENDIENTE amarillo).
 */
export function drawDashHeader(
  d: DashDoc,
  opts: {
    companyName: string;
    companyPhone: string | null;
    companyEmail: string | null;
    title: string; // "CONTRATO DE ALQUILER"
    refCode: string | null; // "#00111"
    dateLabel: string; // "1 de mayo de 2026"
    statusBadge: { label: string; tone: "success" | "warning" | "draft" };
  },
): void {
  const top = PAGE_H - MARGIN;
  // Empresa
  d.page.drawText(opts.companyName, {
    x: MARGIN,
    y: top - 10,
    size: 16,
    font: d.bold,
    color: TEXT,
  });
  if (opts.companyPhone) {
    d.page.drawText(`Tel: ${opts.companyPhone}`, {
      x: MARGIN,
      y: top - 30,
      size: 9,
      font: d.font,
      color: MUTED,
    });
  }
  if (opts.companyEmail) {
    d.page.drawText(opts.companyEmail, {
      x: MARGIN,
      y: top - 42,
      size: 9,
      font: d.font,
      color: MUTED,
    });
  }

  // Título a la derecha
  const titleSize = 22;
  const titleW = d.bold.widthOfTextAtSize(opts.title, titleSize);
  const titleX = PAGE_W - MARGIN - titleW;
  d.page.drawText(opts.title, {
    x: titleX,
    y: top - 10,
    size: titleSize,
    font: d.bold,
    color: TEAL,
  });

  // Bubble badge superpuesto al título (esq. sup. derecha del texto)
  const bubbleBg =
    opts.statusBadge.tone === "success"
      ? SUCCESS_BG
      : opts.statusBadge.tone === "warning"
        ? WARN_BG
        : DRAFT_BG;
  const bubbleTxt =
    opts.statusBadge.tone === "success"
      ? SUCCESS_TXT
      : opts.statusBadge.tone === "warning"
        ? WARN_TXT
        : DRAFT_TXT;
  const bw = d.bold.widthOfTextAtSize(opts.statusBadge.label, 9) + 16;
  const bx = PAGE_W - MARGIN - bw + 4;
  const by = top + 4;
  d.page.drawRectangle({ x: bx, y: by - 14, width: bw, height: 18, color: bubbleBg, borderColor: bubbleBg });
  d.page.drawText(opts.statusBadge.label, {
    x: bx + 8,
    y: by - 10,
    size: 9,
    font: d.bold,
    color: bubbleTxt,
  });

  // Ref + fecha (debajo del título)
  if (opts.refCode) {
    const txt = `Ref: ${opts.refCode}`;
    const w = d.font.widthOfTextAtSize(txt, 9);
    d.page.drawText(txt, { x: PAGE_W - MARGIN - w, y: top - 30, size: 9, font: d.font, color: MUTED });
  }
  const dateTxt = `Fecha: ${opts.dateLabel}`;
  const dw = d.font.widthOfTextAtSize(dateTxt, 9);
  d.page.drawText(dateTxt, { x: PAGE_W - MARGIN - dw, y: top - 42, size: 9, font: d.font, color: MUTED });

  // Línea separadora teal
  d.page.drawLine({
    start: { x: MARGIN, y: top - 60 },
    end: { x: PAGE_W - MARGIN, y: top - 60 },
    thickness: 1.5,
    color: TEAL,
  });

  d.cursorY = top - 80;
}

/**
 * Dos cards lado a lado: LA EMPRESA / EL CLIENTE, con KV.
 */
export function drawTwoPartyCards(
  d: DashDoc,
  left: { title: string; rows: Array<[string, string | null]> },
  right: { title: string; rows: Array<[string, string | null]> },
): void {
  const cardW = (PAGE_W - MARGIN * 2 - 16) / 2;
  const padding = 14;
  const lineH = 16;
  const headerH = 32;
  const maxRows = Math.max(left.rows.length, right.rows.length);
  const cardH = headerH + padding + maxRows * lineH + padding;
  ensure(d, cardH + 10);
  const top = d.cursorY;

  function card(x: number, side: { title: string; rows: Array<[string, string | null]> }) {
    d.page.drawRectangle({
      x,
      y: top - cardH,
      width: cardW,
      height: cardH,
      color: BG,
      borderColor: BG,
    });
    d.page.drawText(side.title, {
      x: x + padding,
      y: top - 22,
      size: 10,
      font: d.bold,
      color: TEAL,
    });
    d.page.drawLine({
      start: { x: x + padding, y: top - 28 },
      end: { x: x + cardW - padding, y: top - 28 },
      thickness: 1,
      color: TEAL,
    });
    side.rows.forEach((r, i) => {
      const y = top - headerH - padding - i * lineH;
      d.page.drawText(`${r[0]}:`, {
        x: x + padding,
        y,
        size: 9,
        font: d.font,
        color: MUTED,
      });
      const value = r[1] ?? "—";
      const lines = wrap(d.font, value, 9, cardW - padding * 2 - 70);
      lines.slice(0, 2).forEach((ln, j) => {
        d.page.drawText(ln, {
          x: x + padding + 70,
          y: y - j * 11,
          size: 9,
          font: d.bold,
          color: TEXT,
        });
      });
    });
  }
  card(MARGIN, left);
  card(MARGIN + cardW + 16, right);
  d.cursorY = top - cardH - 16;
}

/**
 * Fila de "tiles" pequeñas (TIPO / CUOTA / TOTAL / DURACIÓN / FIANZA).
 * Hasta 3 por fila, se autocolocan.
 */
export interface Tile {
  label: string;
  value: string;
  sub?: string;
}
export function drawTiles(d: DashDoc, tiles: Tile[]): void {
  const perRow = 3;
  const gap = 12;
  const tileW = (PAGE_W - MARGIN * 2 - gap * (perRow - 1)) / perRow;
  const tileH = 60;
  for (let i = 0; i < tiles.length; i += perRow) {
    ensure(d, tileH + 10);
    const top = d.cursorY;
    const row = tiles.slice(i, i + perRow);
    row.forEach((t, j) => {
      const x = MARGIN + j * (tileW + gap);
      d.page.drawRectangle({
        x,
        y: top - tileH,
        width: tileW,
        height: tileH,
        borderColor: BORDER,
        borderWidth: 0.6,
      });
      d.page.drawText(t.label, {
        x: x + 12,
        y: top - 18,
        size: 8,
        font: d.font,
        color: MUTED,
      });
      d.page.drawText(t.value, {
        x: x + 12,
        y: top - 36,
        size: 13,
        font: d.bold,
        color: TEXT,
      });
      if (t.sub) {
        d.page.drawText(t.sub, {
          x: x + 12,
          y: top - 50,
          size: 8,
          font: d.font,
          color: MUTED,
        });
      }
    });
    d.cursorY = top - tileH - 12;
  }
}

/**
 * Bloque destacado con borde teal claro: cabecera + cuerpo (ej. "DIRECCIÓN
 * DE INSTALACIÓN", "DATOS BANCARIOS").
 */
export function drawCalloutBlock(
  d: DashDoc,
  opts: { title: string; tone?: "info" | "success"; rows?: Array<[string, string]>; body?: string },
): void {
  const padding = 14;
  const headerH = 28;
  const lineH = 16;
  const rowsH = (opts.rows?.length ?? 0) * lineH;
  const bodyLines = opts.body ? wrap(d.font, opts.body, 10, PAGE_W - MARGIN * 2 - padding * 2) : [];
  const bodyH = bodyLines.length * 13;
  const blockH = headerH + padding + Math.max(rowsH, bodyH) + padding;
  ensure(d, blockH + 8);
  const top = d.cursorY;
  const bg = opts.tone === "success" ? rgb(0.92, 0.98, 0.94) : rgb(0.93, 0.97, 0.99);
  d.page.drawRectangle({
    x: MARGIN,
    y: top - blockH,
    width: PAGE_W - MARGIN * 2,
    height: blockH,
    color: bg,
    borderColor: bg,
  });
  d.page.drawText(opts.title, {
    x: MARGIN + padding,
    y: top - 18,
    size: 10,
    font: d.bold,
    color: TEAL,
  });
  d.page.drawLine({
    start: { x: MARGIN + padding, y: top - 24 },
    end: { x: PAGE_W - MARGIN - padding, y: top - 24 },
    thickness: 1,
    color: TEAL,
  });
  if (opts.rows && opts.rows.length > 0) {
    opts.rows.forEach((r, i) => {
      const y = top - headerH - padding - i * lineH;
      d.page.drawText(`${r[0]}:`, {
        x: MARGIN + padding,
        y,
        size: 9,
        font: d.font,
        color: MUTED,
      });
      d.page.drawText(r[1], {
        x: MARGIN + padding + 80,
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
        y: top - headerH - padding - i * 13,
        size: 10,
        font: d.font,
        color: TEXT,
      });
    });
  }
  d.cursorY = top - blockH - 12;
}

/**
 * Titular de sección sin caja, con línea inferior fina.
 */
export function drawSectionTitle(d: DashDoc, label: string): void {
  ensure(d, 30);
  d.cursorY -= 10;
  d.page.drawText(label, {
    x: MARGIN,
    y: d.cursorY,
    size: 11,
    font: d.bold,
    color: TEAL,
  });
  d.cursorY -= 6;
  d.page.drawLine({
    start: { x: MARGIN, y: d.cursorY },
    end: { x: PAGE_W - MARGIN, y: d.cursorY },
    thickness: 0.6,
    color: BORDER,
  });
  d.cursorY -= 10;
}

export function drawParagraph(d: DashDoc, text: string, size = 10): void {
  const lines = wrap(d.font, text, size, PAGE_W - MARGIN * 2);
  ensure(d, lines.length * (size + 3) + 6);
  for (const ln of lines) {
    d.cursorY -= size + 3;
    d.page.drawText(ln, { x: MARGIN, y: d.cursorY, size, font: d.font, color: TEXT });
  }
  d.cursorY -= 4;
}

export function drawClauseList(
  d: DashDoc,
  clauses: Array<{ title: string; body: string }>,
): void {
  for (const c of clauses) {
    ensure(d, 40);
    d.cursorY -= 14;
    d.page.drawText(c.title.toUpperCase(), {
      x: MARGIN,
      y: d.cursorY,
      size: 10,
      font: d.bold,
      color: TEAL,
    });
    d.cursorY -= 4;
    drawParagraph(d, c.body, 10);
    d.cursorY -= 4;
  }
}

export interface ItemsRow {
  product: string;
  qty: number | string;
  price: string;
  subtotal: string;
}

/**
 * Tabla de productos estilo DashStack: header gris claro + filas con borde
 * inferior fino.
 */
export function drawItemsTable(d: DashDoc, rows: ItemsRow[]): void {
  const cols = [240, 70, 100, 105]; // product, qty, price, subtotal
  const headerH = 24;
  ensure(d, headerH + rows.length * 22 + 10);

  // Header
  d.cursorY -= headerH;
  const headerY = d.cursorY;
  d.page.drawRectangle({
    x: MARGIN,
    y: headerY - 4,
    width: PAGE_W - MARGIN * 2,
    height: headerH,
    color: BG,
    borderColor: BG,
  });
  let x = MARGIN + 12;
  ["Producto", "Cantidad", "Precio", "Subtotal"].forEach((h, i) => {
    const align = i === 0 ? "left" : "right";
    if (align === "left") {
      d.page.drawText(h, { x, y: headerY + 6, size: 9, font: d.bold, color: TEXT });
    } else {
      const w = d.bold.widthOfTextAtSize(h, 9);
      d.page.drawText(h, {
        x: x + cols[i]! - 12 - w,
        y: headerY + 6,
        size: 9,
        font: d.bold,
        color: TEXT,
      });
    }
    x += cols[i]!;
  });

  // Rows
  for (const r of rows) {
    ensure(d, 22);
    d.cursorY -= 22;
    const y = d.cursorY;
    let cx = MARGIN + 12;
    const cells = [r.product, String(r.qty), r.price, r.subtotal];
    cells.forEach((c, i) => {
      const align = i === 0 ? "left" : "right";
      if (align === "left") {
        d.page.drawText(c, { x: cx, y: y + 6, size: 10, font: d.font, color: TEXT });
      } else {
        const w = d.font.widthOfTextAtSize(c, 10);
        d.page.drawText(c, {
          x: cx + cols[i]! - 12 - w,
          y: y + 6,
          size: 10,
          font: d.font,
          color: TEXT,
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
  }
  d.cursorY -= 8;
}

/**
 * Bloque firmas: dos columnas con línea + nombre + DNI + fecha.
 */
export function drawSignatureBlock(
  d: DashDoc,
  opts: {
    company: { name: string; signatureBytes?: Uint8Array | null };
    customer: { name: string; taxId: string | null; signedDate: string | null; signatureBytes?: Uint8Array | null };
  },
): void {
  ensure(d, 130);
  const top = d.cursorY - 20;
  const colW = (PAGE_W - MARGIN * 2 - 30) / 2;

  function column(x: number, header: string, name: string, lines: string[], img?: Uint8Array | null) {
    if (img) {
      try {
        // Embedded async, pero lo intentamos sólo si llega
      } catch {
        /* skip */
      }
    }
    // Línea
    d.page.drawLine({
      start: { x: x + 20, y: top - 60 },
      end: { x: x + colW - 20, y: top - 60 },
      thickness: 0.8,
      color: TEXT,
    });
    d.page.drawText(header, {
      x: x + colW / 2 - d.font.widthOfTextAtSize(header, 9) / 2,
      y: top - 75,
      size: 9,
      font: d.font,
      color: MUTED,
    });
    d.page.drawText(name, {
      x: x + colW / 2 - d.bold.widthOfTextAtSize(name, 11) / 2,
      y: top - 90,
      size: 11,
      font: d.bold,
      color: TEXT,
    });
    lines.forEach((ln, i) => {
      d.page.drawText(ln, {
        x: x + colW / 2 - d.font.widthOfTextAtSize(ln, 9) / 2,
        y: top - 105 - i * 12,
        size: 9,
        font: d.font,
        color: MUTED,
      });
    });
  }

  column(MARGIN, "Firma de la Empresa", opts.company.name, []);
  const custLines: string[] = [];
  if (opts.customer.taxId) custLines.push(`DNI: ${opts.customer.taxId}`);
  if (opts.customer.signedDate) custLines.push(`Firmado: ${opts.customer.signedDate}`);
  column(MARGIN + colW + 30, "Firma del Cliente", opts.customer.name, custLines);

  d.cursorY = top - 140;
}

/**
 * Footer con metadatos: empresa · contrato · generado · firmado
 */
export function drawDashFooter(d: DashDoc, text: string): void {
  // En todas las páginas creadas
  const pages = d.pdf.getPages();
  for (const p of pages) {
    p.drawText(text, {
      x: PAGE_W / 2 - d.font.widthOfTextAtSize(text, 8) / 2,
      y: 30,
      size: 8,
      font: d.font,
      color: MUTED,
    });
  }
}

export function fmtEur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function fmtDateLong(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

export function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES");
}

export function watermarkFromContractStatus(
  status: string,
  pendingFields: string[],
): { label: string; tone: "success" | "warning" | "draft" } {
  if (status === "active" || status === "signed" || status === "completed") {
    return { label: "FIRMADO", tone: "success" };
  }
  if (pendingFields && pendingFields.length > 0) {
    const map: Record<string, string> = {
      iban: "IBAN",
      dni: "DNI",
      signature: "FIRMA",
      address: "DIRECCIÓN",
      payment: "PAGO",
      data: "DATOS",
    };
    const first = map[pendingFields[0]!] ?? pendingFields[0]!.toUpperCase();
    return { label: `PDTE: ${first}`, tone: "warning" };
  }
  if (status === "pending_signature") return { label: "PDTE FIRMA", tone: "warning" };
  if (status === "pending_data") return { label: "PDTE DATOS", tone: "warning" };
  if (status === "cancelled") return { label: "CANCELADO", tone: "draft" };
  return { label: "BORRADOR", tone: "draft" };
}

export function watermarkFromProposalStatus(status: string): {
  label: string;
  tone: "success" | "warning" | "draft";
} {
  if (status === "accepted") return { label: "ACEPTADA", tone: "success" };
  if (status === "sent") return { label: "ENVIADA", tone: "warning" };
  if (status === "rejected") return { label: "RECHAZADA", tone: "draft" };
  if (status === "expired") return { label: "EXPIRADA", tone: "draft" };
  return { label: "BORRADOR", tone: "draft" };
}
