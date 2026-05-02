import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  StandardFonts,
  rgb,
  type RGB,
} from "pdf-lib";

export const COLORS = {
  brand: rgb(72 / 255, 128 / 255, 255 / 255),
  text: rgb(0.13, 0.13, 0.18),
  muted: rgb(0.45, 0.48, 0.55),
  border: rgb(0.86, 0.88, 0.93),
  bg: rgb(0.97, 0.98, 0.99),
  white: rgb(1, 1, 1),
  success: rgb(0.16, 0.74, 0.46),
  warning: rgb(0.95, 0.62, 0.04),
};

export interface Doc {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  cursorY: number;
  margin: number;
  width: number;
  height: number;
}

export async function newDoc(): Promise<Doc> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]); // A4
  return {
    pdf,
    page,
    font,
    bold,
    cursorY: 800,
    margin: 50,
    width: 595,
    height: 842,
  };
}

export function ensureSpace(doc: Doc, needed: number): void {
  if (doc.cursorY - needed < doc.margin) {
    doc.page = doc.pdf.addPage([595, 842]);
    doc.cursorY = 800;
  }
}

export function drawText(
  doc: Doc,
  text: string,
  opts: { x?: number; size?: number; bold?: boolean; color?: RGB; maxWidth?: number } = {},
): void {
  const size = opts.size ?? 11;
  const font = opts.bold ? doc.bold : doc.font;
  const color = opts.color ?? COLORS.text;
  const x = opts.x ?? doc.margin;
  if (opts.maxWidth) {
    const lines = wrapText(text, font, size, opts.maxWidth);
    ensureSpace(doc, size * lines.length + 2);
    for (const line of lines) {
      doc.cursorY -= size * 1.2;
      doc.page.drawText(line, { x, y: doc.cursorY, size, font, color });
    }
  } else {
    ensureSpace(doc, size + 2);
    doc.cursorY -= size * 1.2;
    doc.page.drawText(text, { x, y: doc.cursorY, size, font, color });
  }
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

export function drawHeader(doc: Doc, title: string, subtitle?: string): void {
  doc.page.drawRectangle({
    x: 0,
    y: doc.height - 80,
    width: doc.width,
    height: 80,
    color: COLORS.brand,
  });
  doc.page.drawText(title, {
    x: doc.margin,
    y: doc.height - 40,
    size: 22,
    font: doc.bold,
    color: COLORS.white,
  });
  if (subtitle) {
    doc.page.drawText(subtitle, {
      x: doc.margin,
      y: doc.height - 60,
      size: 11,
      font: doc.font,
      color: COLORS.white,
    });
  }
  doc.cursorY = doc.height - 100;
}

export function drawHr(doc: Doc, gap = 8): void {
  ensureSpace(doc, gap * 2);
  doc.cursorY -= gap;
  doc.page.drawLine({
    start: { x: doc.margin, y: doc.cursorY },
    end: { x: doc.width - doc.margin, y: doc.cursorY },
    thickness: 0.5,
    color: COLORS.border,
  });
  doc.cursorY -= gap;
}

export function drawSection(doc: Doc, title: string): void {
  ensureSpace(doc, 30);
  doc.cursorY -= 18;
  doc.page.drawText(title.toUpperCase(), {
    x: doc.margin,
    y: doc.cursorY,
    size: 10,
    font: doc.bold,
    color: COLORS.brand,
  });
  doc.cursorY -= 6;
  doc.page.drawLine({
    start: { x: doc.margin, y: doc.cursorY },
    end: { x: doc.width - doc.margin, y: doc.cursorY },
    thickness: 1,
    color: COLORS.brand,
  });
  doc.cursorY -= 4;
}

export function drawKeyValue(doc: Doc, key: string, value: string): void {
  ensureSpace(doc, 16);
  doc.cursorY -= 14;
  doc.page.drawText(key, {
    x: doc.margin,
    y: doc.cursorY,
    size: 10,
    font: doc.bold,
    color: COLORS.muted,
  });
  doc.page.drawText(value, {
    x: doc.margin + 140,
    y: doc.cursorY,
    size: 10,
    font: doc.font,
    color: COLORS.text,
  });
}

export interface TableRow {
  cells: string[];
}

export function drawTable(
  doc: Doc,
  headers: string[],
  rows: TableRow[],
  widths: number[],
): void {
  const rowHeight = 18;
  ensureSpace(doc, rowHeight);
  doc.cursorY -= rowHeight;

  // Header
  doc.page.drawRectangle({
    x: doc.margin,
    y: doc.cursorY - 4,
    width: doc.width - doc.margin * 2,
    height: rowHeight,
    color: COLORS.bg,
  });
  let cx = doc.margin + 4;
  headers.forEach((h, i) => {
    doc.page.drawText(h, {
      x: cx,
      y: doc.cursorY,
      size: 9,
      font: doc.bold,
      color: COLORS.muted,
    });
    cx += widths[i]!;
  });

  for (const row of rows) {
    ensureSpace(doc, rowHeight);
    doc.cursorY -= rowHeight;
    cx = doc.margin + 4;
    row.cells.forEach((c, i) => {
      doc.page.drawText(c, {
        x: cx,
        y: doc.cursorY,
        size: 10,
        font: doc.font,
        color: COLORS.text,
      });
      cx += widths[i]!;
    });
    doc.page.drawLine({
      start: { x: doc.margin, y: doc.cursorY - 4 },
      end: { x: doc.width - doc.margin, y: doc.cursorY - 4 },
      thickness: 0.3,
      color: COLORS.border,
    });
  }
}

export function fmtEur(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}

export function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES");
}

export async function embedImage(
  doc: Doc,
  bytes: Uint8Array,
  mime: string,
): Promise<{ embed: PDFImage; width: number; height: number }> {
  const embed = mime.includes("png")
    ? await doc.pdf.embedPng(bytes)
    : await doc.pdf.embedJpg(bytes);
  return { embed, width: embed.width, height: embed.height };
}
