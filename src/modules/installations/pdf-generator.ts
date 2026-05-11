"use server";

import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFImage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

// ============================================================================
// Diseño (mismo estilo que contrato / albarán)
// ============================================================================
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;

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
const WARN_BG = rgb(1.0, 0.95, 0.78);
const WARN_TXT = rgb(0.6, 0.4, 0.0);
const DANGER_BG = rgb(0.99, 0.91, 0.91);
const DANGER_TXT = rgb(0.7, 0.18, 0.18);

interface Doc {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  cursorY: number;
}

async function newDoc(): Promise<Doc> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  return { pdf, page, font, bold, italic, cursorY: PAGE_H - MARGIN };
}

function newPage(d: Doc): void {
  d.page = d.pdf.addPage([PAGE_W, PAGE_H]);
  d.cursorY = PAGE_H - MARGIN;
}

function ensure(d: Doc, needed: number): void {
  if (d.cursorY - needed < 70) newPage(d);
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const paragraphs = text.split(/\n/);
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para.trim().length === 0) {
      out.push("");
      continue;
    }
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
  }
  return out;
}

function fmtDateOnly(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtTimeOnly(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTimeShort(d: string | null | undefined): string {
  if (!d) return "—";
  return `${fmtDateOnly(d)} ${fmtTimeOnly(d)}`;
}

function fmtDurationSec(s: number | null | undefined): string {
  if (s == null || s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}

// ============================================================================
// Componentes visuales
// ============================================================================
const STATUS_META: Record<
  string,
  { label: string; bg: ReturnType<typeof rgb>; txt: ReturnType<typeof rgb> }
> = {
  unscheduled: { label: "SIN PROGRAMAR", bg: BG_SOFT, txt: MUTED },
  scheduled: { label: "PROGRAMADA", bg: TEAL_LIGHT, txt: TEAL_DARK },
  in_progress: { label: "EN CURSO", bg: WARN_BG, txt: WARN_TXT },
  paused: { label: "PAUSADA", bg: WARN_BG, txt: WARN_TXT },
  completed: { label: "FINALIZADA", bg: SUCCESS_BG, txt: SUCCESS },
  cancelled: { label: "CANCELADA", bg: DANGER_BG, txt: DANGER_TXT },
};

function drawHeader(
  d: Doc,
  opts: {
    refCode: string;
    status: string;
    companyName: string;
    companyTaxId: string | null;
    companyContact: string | null;
  },
): void {
  d.page.drawRectangle({ x: 0, y: PAGE_H - 12, width: PAGE_W, height: 12, color: TEAL });

  // Empresa izda
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
  if (opts.companyContact) {
    d.page.drawText(opts.companyContact, {
      x: MARGIN,
      y,
      size: 8.5,
      font: d.font,
      color: MUTED,
    });
  }

  // Ref derecha
  const refTxt = `Ref. ${opts.refCode}`;
  const rw = d.bold.widthOfTextAtSize(refTxt, 10);
  d.page.drawText(refTxt, {
    x: PAGE_W - MARGIN - rw,
    y: PAGE_H - 35,
    size: 10,
    font: d.bold,
    color: TEAL_DARK,
  });

  // Badge estado GRANDE (FINALIZADA / EN CURSO / etc.)
  const meta = STATUS_META[opts.status] ?? STATUS_META.scheduled!;
  const badgeText = meta.label;
  const padX = 14;
  const padY = 8;
  const fontSize = 12;
  const txtW = d.bold.widthOfTextAtSize(badgeText, fontSize);
  const badgeW = txtW + padX * 2;
  const badgeH = fontSize + padY * 2;
  const bx = PAGE_W - MARGIN - badgeW;
  const by = PAGE_H - 80;
  d.page.drawRectangle({
    x: bx,
    y: by - badgeH,
    width: badgeW,
    height: badgeH,
    color: meta.bg,
    borderColor: meta.txt,
    borderWidth: 1,
  });
  d.page.drawText(badgeText, {
    x: bx + padX,
    y: by - badgeH + padY,
    size: fontSize,
    font: d.bold,
    color: meta.txt,
  });

  // Título centrado
  const title = "PARTE DE TRABAJO";
  const titleSize = 22;
  const tw = d.bold.widthOfTextAtSize(title, titleSize);
  const titleY = PAGE_H - 130;
  d.page.drawText(title, {
    x: PAGE_W / 2 - tw / 2,
    y: titleY,
    size: titleSize,
    font: d.bold,
    color: TEAL_DARK,
  });
  d.page.drawRectangle({
    x: PAGE_W / 2 - 30,
    y: titleY - 8,
    width: 60,
    height: 3,
    color: TEAL,
  });
  const sub = "Instalación de equipos en domicilio del cliente";
  const sw = d.italic.widthOfTextAtSize(sub, 10);
  d.page.drawText(sub, {
    x: PAGE_W / 2 - sw / 2,
    y: titleY - 24,
    size: 10,
    font: d.italic,
    color: MUTED,
  });
  d.cursorY = titleY - 50;
}

function drawCustomerCard(
  d: Doc,
  customer: { name: string; taxId: string | null; address: string | null },
): void {
  const padding = 14;
  const lineH = 14;
  const rows: Array<[string, string]> = [
    ["Cliente", customer.name],
    ["DNI/CIF", customer.taxId ?? "—"],
    ["Dirección de instalación", customer.address ?? "—"],
  ];
  const cardH = 30 + rows.length * lineH + padding;
  ensure(d, cardH + 10);
  const top = d.cursorY;
  d.page.drawRectangle({
    x: MARGIN,
    y: top - cardH,
    width: CONTENT_W,
    height: cardH,
    color: TEAL_LIGHT,
    borderColor: TEAL,
    borderWidth: 0.6,
  });
  d.page.drawText("CLIENTE Y LUGAR", {
    x: MARGIN + padding,
    y: top - 18,
    size: 9.5,
    font: d.bold,
    color: TEAL_DARK,
  });
  rows.forEach((r, i) => {
    const y = top - 35 - i * lineH;
    d.page.drawText(`${r[0]}:`, {
      x: MARGIN + padding,
      y,
      size: 9,
      font: d.font,
      color: MUTED,
    });
    const lines = wrap(d.bold, r[1], 9.5, CONTENT_W - padding * 2 - 150);
    d.page.drawText(lines[0] ?? "—", {
      x: MARGIN + padding + 150,
      y,
      size: 9.5,
      font: d.bold,
      color: TEXT,
    });
  });
  d.cursorY = top - cardH - 14;
}

function drawTiles(
  d: Doc,
  tiles: Array<{ label: string; value: string; sub?: string; tone?: "info" | "success" }>,
): void {
  const perRow = Math.min(4, tiles.length);
  const gap = 10;
  const tileW = (CONTENT_W - gap * (perRow - 1)) / perRow;
  const tileH = 64;
  for (let i = 0; i < tiles.length; i += perRow) {
    ensure(d, tileH + 10);
    const top = d.cursorY;
    const row = tiles.slice(i, i + perRow);
    row.forEach((t, j) => {
      const x = MARGIN + j * (tileW + gap);
      const bandColor = t.tone === "success" ? SUCCESS : TEAL;
      d.page.drawRectangle({
        x,
        y: top - tileH,
        width: tileW,
        height: tileH,
        color: WHITE,
        borderColor: BORDER,
        borderWidth: 0.6,
      });
      d.page.drawRectangle({
        x,
        y: top - tileH,
        width: 4,
        height: tileH,
        color: bandColor,
      });
      d.page.drawText(t.label.toUpperCase(), {
        x: x + 12,
        y: top - 18,
        size: 7.5,
        font: d.bold,
        color: TEAL_DARK,
      });
      const valSize = t.value.length > 12 ? 12 : 14;
      d.page.drawText(t.value, {
        x: x + 12,
        y: top - 38,
        size: valSize,
        font: d.bold,
        color: TEXT,
      });
      if (t.sub) {
        d.page.drawText(t.sub, {
          x: x + 12,
          y: top - 54,
          size: 7.5,
          font: d.font,
          color: MUTED,
        });
      }
    });
    d.cursorY = top - tileH - 12;
  }
}

function drawCallout(
  d: Doc,
  opts: {
    title: string;
    rows: Array<[string, string, "ok" | "warn"]>;
  },
): void {
  const padding = 14;
  const lineH = 18;
  const blockH = 28 + opts.rows.length * lineH + padding;
  ensure(d, blockH + 10);
  const top = d.cursorY;
  d.page.drawRectangle({
    x: MARGIN,
    y: top - blockH,
    width: CONTENT_W,
    height: blockH,
    color: BG_SOFT,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  d.page.drawText(opts.title, {
    x: MARGIN + padding,
    y: top - 18,
    size: 10,
    font: d.bold,
    color: TEAL_DARK,
  });
  opts.rows.forEach((r, i) => {
    const y = top - 38 - i * lineH;
    d.page.drawText(r[0], {
      x: MARGIN + padding,
      y,
      size: 10,
      font: d.font,
      color: TEXT,
    });
    const badgeBg = r[2] === "warn" ? WARN_BG : SUCCESS_BG;
    const badgeTxt = r[2] === "warn" ? WARN_TXT : SUCCESS;
    const tw = d.bold.widthOfTextAtSize(r[1], 9);
    const bw = tw + 14;
    d.page.drawRectangle({
      x: MARGIN + CONTENT_W - padding - bw,
      y: y - 3,
      width: bw,
      height: 14,
      color: badgeBg,
      borderColor: badgeBg,
    });
    d.page.drawText(r[1], {
      x: MARGIN + CONTENT_W - padding - bw + 7,
      y: y,
      size: 9,
      font: d.bold,
      color: badgeTxt,
    });
  });
  d.cursorY = top - blockH - 14;
}

function drawSection(d: Doc, label: string): void {
  ensure(d, 30);
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

function drawEquipmentCards(
  d: Doc,
  items: Array<{ name: string; quantity: number; serial: string | null; notes: string | null }>,
): void {
  for (const it of items) {
    ensure(d, 50);
    const cardH = 48;
    const top = d.cursorY;
    d.page.drawRectangle({
      x: MARGIN,
      y: top - cardH,
      width: CONTENT_W,
      height: cardH,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
    d.page.drawRectangle({
      x: MARGIN,
      y: top - cardH,
      width: 4,
      height: cardH,
      color: SUCCESS,
    });
    const qtyTxt = `×${it.quantity}`;
    const qw = d.bold.widthOfTextAtSize(qtyTxt, 13);
    d.page.drawRectangle({
      x: MARGIN + 12,
      y: top - 38,
      width: qw + 14,
      height: 22,
      color: TEAL_DARK,
    });
    d.page.drawText(qtyTxt, {
      x: MARGIN + 19,
      y: top - 32,
      size: 13,
      font: d.bold,
      color: WHITE,
    });
    const nameLines = wrap(d.bold, it.name, 11, CONTENT_W - 200);
    d.page.drawText(nameLines[0] ?? "—", {
      x: MARGIN + 12 + qw + 26,
      y: top - 22,
      size: 11,
      font: d.bold,
      color: TEXT,
    });
    const subParts: string[] = [];
    if (it.serial) subParts.push(`S/N: ${it.serial}`);
    if (it.notes) subParts.push(it.notes);
    if (subParts.length > 0) {
      d.page.drawText(subParts.join(" · "), {
        x: MARGIN + 12 + qw + 26,
        y: top - 37,
        size: 9,
        font: d.font,
        color: MUTED,
      });
    }
    d.cursorY = top - cardH - 8;
  }
}

interface PhotoEmbed {
  category: string;
  image: PDFImage;
}

const PHOTO_LABEL: Record<string, string> = {
  equipment: "Equipo",
  equipment_location: "Equipo",
  connection: "Conexión",
  network_connection: "Conexión",
  damage: "Daño",
  previous_damage: "Daño previo",
  countertop_drilling: "Encimera",
  before: "Antes",
  after: "Después",
  extra: "Otra",
  other: "Otra",
};

function drawPhotoGrid(d: Doc, photos: PhotoEmbed[]): void {
  if (photos.length === 0) return;
  const cols = 3;
  const gap = 8;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cellH = cellW * 0.75;
  const rowH = cellH + 22;

  for (let i = 0; i < photos.length; i += cols) {
    ensure(d, rowH + 6);
    const top = d.cursorY;
    const row = photos.slice(i, i + cols);
    row.forEach((p, j) => {
      const x = MARGIN + j * (cellW + gap);
      d.page.drawRectangle({
        x,
        y: top - cellH,
        width: cellW,
        height: cellH,
        color: BG_SOFT,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      const ratio = p.image.width / p.image.height;
      let w = cellW;
      let h = w / ratio;
      if (h > cellH) {
        h = cellH;
        w = h * ratio;
      }
      d.page.drawImage(p.image, {
        x: x + (cellW - w) / 2,
        y: top - cellH + (cellH - h) / 2,
        width: w,
        height: h,
      });
      const cat = PHOTO_LABEL[p.category] ?? p.category;
      d.page.drawText(cat, {
        x: x + 4,
        y: top - cellH - 12,
        size: 8,
        font: d.bold,
        color: TEAL_DARK,
      });
    });
    d.cursorY = top - rowH;
  }
}

function drawSignatures(
  d: Doc,
  opts: {
    installer: { name: string; signedDate: string | null; image?: PDFImage | null };
    customer: {
      name: string;
      taxId: string | null;
      signedDate: string | null;
      image?: PDFImage | null;
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
    extras: string[],
    image?: PDFImage | null,
  ) {
    d.page.drawRectangle({
      x,
      y: top - blockH,
      width: colW,
      height: blockH,
      color: BG_SOFT,
      borderColor: BORDER,
      borderWidth: 0.6,
    });
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
    const imgArea = { x: x + 14, y: top - 90, width: colW - 28, height: 55 };
    if (image) {
      const ratio = image.width / image.height;
      let w = imgArea.width;
      let h = w / ratio;
      if (h > imgArea.height) {
        h = imgArea.height;
        w = h * ratio;
      }
      d.page.drawImage(image, {
        x: imgArea.x + (imgArea.width - w) / 2,
        y: imgArea.y + (imgArea.height - h) / 2,
        width: w,
        height: h,
      });
    } else {
      const placeholder = "— pendiente de firma —";
      d.page.drawText(placeholder, {
        x: x + colW / 2 - d.italic.widthOfTextAtSize(placeholder, 9) / 2,
        y: top - 60,
        size: 9,
        font: d.italic,
        color: MUTED,
      });
    }
    d.page.drawLine({
      start: { x: x + 30, y: top - 95 },
      end: { x: x + colW - 30, y: top - 95 },
      thickness: 0.8,
      color: TEXT,
    });
    const nw = d.bold.widthOfTextAtSize(name, 10);
    d.page.drawText(name, {
      x: x + colW / 2 - nw / 2,
      y: top - 108,
      size: 10,
      font: d.bold,
      color: TEXT,
    });
    extras.forEach((e, i) => {
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

  const installerExtras: string[] = [];
  if (opts.installer.signedDate) installerExtras.push(`Firmado: ${opts.installer.signedDate}`);
  column(
    MARGIN,
    "FIRMA DEL INSTALADOR",
    opts.installer.name,
    installerExtras,
    opts.installer.image,
  );
  const customerExtras: string[] = [];
  if (opts.customer.taxId) customerExtras.push(`DNI/CIF: ${opts.customer.taxId}`);
  if (opts.customer.signedDate) customerExtras.push(`Firmado: ${opts.customer.signedDate}`);
  column(
    MARGIN + colW + 20,
    "FIRMA DEL CLIENTE",
    opts.customer.name,
    customerExtras,
    opts.customer.image,
  );
  d.cursorY = top - blockH - 14;
}

function drawFooters(
  d: Doc,
  opts: {
    companyName: string;
    refCode: string;
    startedAt: string | null;
    completedAt: string | null;
  },
): void {
  const pages = d.pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({
      start: { x: MARGIN, y: 44 },
      end: { x: PAGE_W - MARGIN, y: 44 },
      thickness: 0.3,
      color: BORDER,
    });
    p.drawText(opts.companyName, {
      x: MARGIN,
      y: 30,
      size: 7.5,
      font: d.bold,
      color: MUTED,
    });
    const center = `Parte ${opts.refCode}`;
    const cw = d.font.widthOfTextAtSize(center, 7.5);
    p.drawText(center, {
      x: PAGE_W / 2 - cw / 2,
      y: 30,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
    const pageTxt = `Pág. ${idx + 1} / ${pages.length}`;
    const pw = d.font.widthOfTextAtSize(pageTxt, 7.5);
    p.drawText(pageTxt, {
      x: PAGE_W - MARGIN - pw,
      y: 30,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
    // Resumen tiempos abajo (decisión usuario 2026-05-11: día/hora/hora bajo)
    const parts: string[] = [];
    if (opts.startedAt) parts.push(`Inicio: ${fmtDateTimeShort(opts.startedAt)}`);
    if (opts.completedAt) parts.push(`Fin: ${fmtDateTimeShort(opts.completedAt)}`);
    const stamp = parts.join("  ·  ");
    if (stamp) {
      const sw = d.bold.widthOfTextAtSize(stamp, 7.5);
      p.drawText(stamp, {
        x: PAGE_W / 2 - sw / 2,
        y: 16,
        size: 7.5,
        font: d.bold,
        color: SUCCESS,
      });
    }
  });
}

// ============================================================================
// Helpers de datos
// ============================================================================
async function downloadFromBuckets(
  buckets: string[],
  storagePath: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  for (const bucket of buckets) {
    try {
      const { data, error } = await admin.storage.from(bucket).download(storagePath);
      if (error || !data) continue;
      const arr = new Uint8Array(await (data as Blob).arrayBuffer());
      const mime =
        (data as Blob).type || (storagePath.endsWith(".png") ? "image/png" : "image/jpeg");
      return { bytes: arr, mime };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function embedFromStorage(
  pdf: PDFDocument,
  buckets: string[],
  path: string,
): Promise<PDFImage | null> {
  const dl = await downloadFromBuckets(buckets, path);
  if (!dl) return null;
  try {
    if (dl.mime.includes("png")) return await pdf.embedPng(dl.bytes);
    if (dl.mime.includes("jpeg") || dl.mime.includes("jpg")) return await pdf.embedJpg(dl.bytes);
    try {
      return await pdf.embedPng(dl.bytes);
    } catch {
      return await pdf.embedJpg(dl.bytes);
    }
  } catch {
    return null;
  }
}

// ============================================================================
// Generador principal
// ============================================================================
export async function generateWorkReportPdf(installationId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [
    { data: inst },
    { data: items },
    { data: photos },
    { data: signatures },
    { data: company },
    { data: cs },
  ] = await Promise.all([
    supabase
      .from("installations")
      .select(
        "id, reference_code, status, kind, scheduled_at, started_at, completed_at, duration_seconds, notes, customer_id, contract_id, address_id, installer_user_id, has_previous_damage, needs_countertop_drilling, started_geo_lat, started_geo_lng, geo_distance_to_address_m",
      )
      .eq("id", installationId)
      .single(),
    supabase
      .from("installation_items")
      .select("product_id, serial_number, quantity, notes")
      .eq("installation_id", installationId),
    supabase
      .from("installation_photos")
      .select("storage_path, category, taken_at")
      .eq("installation_id", installationId)
      .order("taken_at"),
    supabase
      .from("installation_signatures")
      .select("signer_role, signer_name, signer_tax_id, context, signed_at, signature_image_path")
      .eq("installation_id", installationId)
      .order("signed_at"),
    supabase
      .from("companies")
      .select("legal_name, trade_name, tax_id")
      .eq("id", session.company_id)
      .single(),
    supabase
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_tax_id, contact_phone, contact_email")
      .eq("company_id", session.company_id)
      .maybeSingle(),
  ]);

  if (!inst) throw new Error("Instalación no encontrada");
  const i = inst as {
    id: string;
    reference_code: string | null;
    status: string;
    kind: string;
    scheduled_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    notes: string | null;
    customer_id: string | null;
    address_id: string | null;
    installer_user_id: string | null;
    has_previous_damage: boolean | null;
    needs_countertop_drilling: boolean | null;
    started_geo_lat: number | null;
    started_geo_lng: number | null;
    geo_distance_to_address_m: number | null;
  };

  // Cliente
  let customerName = "—";
  let customerTaxId: string | null = null;
  if (i.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
      .eq("id", i.customer_id)
      .single();
    if (c) {
      const cc = c as {
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
        tax_id: string | null;
      };
      customerName =
        cc.party_kind === "company"
          ? cc.trade_name || cc.legal_name || "—"
          : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "—";
      customerTaxId = cc.tax_id;
    }
  }

  // Dirección
  let addressLine: string | null = null;
  if (i.address_id) {
    const { data: a } = await supabase
      .from("addresses")
      .select(
        "street_type, street, street_number, portal, floor, door, postal_code, city, province",
      )
      .eq("id", i.address_id)
      .maybeSingle();
    if (a) {
      addressLine =
        [
          `${a.street_type ?? ""} ${a.street ?? ""} ${a.street_number ?? ""}`.trim(),
          a.portal ? `Portal ${a.portal}` : null,
          a.floor ?? null,
          a.door ?? null,
          a.postal_code,
          a.city,
          a.province,
        ]
          .filter(Boolean)
          .join(", ") || null;
    }
  }

  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const csObj = (cs ?? {}) as {
    fiscal_legal_name?: string | null;
    fiscal_tax_id?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
  };
  const companyName = co.trade_name || co.legal_name || csObj.fiscal_legal_name || "Empresa";
  const companyTaxId = co.tax_id ?? csObj.fiscal_tax_id ?? null;
  const companyContact =
    [csObj.contact_phone, csObj.contact_email].filter(Boolean).join(" · ") || null;

  const itemList = (items ?? []) as Array<{
    product_id: string;
    serial_number: string | null;
    quantity: number;
    notes: string | null;
  }>;
  const productNames = new Map<string, string>();
  if (itemList.length > 0) {
    const productIds = Array.from(new Set(itemList.map((it) => it.product_id)));
    const { data: prods } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);
    for (const p of (prods ?? []) as Array<{ id: string; name: string }>) {
      productNames.set(p.id, p.name);
    }
  }

  // Nombre instalador
  let installerName = "Técnico";
  if (i.installer_user_id) {
    const { data: prof } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", i.installer_user_id)
      .maybeSingle();
    installerName = (prof as { full_name: string | null } | null)?.full_name ?? "Técnico";
  }

  const doc = await newDoc();
  // Buckets posibles para imágenes — varían según versión del wizard que las subió.
  const PHOTO_BUCKETS = ["installation-photos", "documents"];
  const SIG_BUCKETS = ["installation-signatures", "documents"];

  // Embed fotos
  const photoList = (photos ?? []) as Array<{
    storage_path: string;
    category: string;
    taken_at: string;
  }>;
  const photoEmbeds: PhotoEmbed[] = [];
  for (const p of photoList) {
    const img = await embedFromStorage(doc.pdf, PHOTO_BUCKETS, p.storage_path);
    if (img) photoEmbeds.push({ category: p.category, image: img });
  }

  // Firmas (la más reciente de cada rol con context='work_report')
  const sigList = (signatures ?? []) as Array<{
    signer_role: "customer" | "installer" | "witness";
    signer_name: string;
    signer_tax_id: string | null;
    context: string | null;
    signed_at: string;
    signature_image_path: string;
  }>;
  const sortedSigs = [...sigList].sort(
    (a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime(),
  );
  const customerSig =
    sortedSigs.find((s) => s.signer_role === "customer" && s.context === "work_report") ??
    sortedSigs.find((s) => s.signer_role === "customer");
  const installerSig =
    sortedSigs.find((s) => s.signer_role === "installer" && s.context === "work_report") ??
    sortedSigs.find((s) => s.signer_role === "installer");

  const customerSigImage = customerSig
    ? await embedFromStorage(doc.pdf, SIG_BUCKETS, customerSig.signature_image_path)
    : null;
  const installerSigImage = installerSig
    ? await embedFromStorage(doc.pdf, SIG_BUCKETS, installerSig.signature_image_path)
    : null;

  // ============================================================================
  // RENDER
  // ============================================================================
  drawHeader(doc, {
    refCode: i.reference_code ?? `#${i.id.slice(0, 8)}`,
    status: i.status,
    companyName,
    companyTaxId,
    companyContact,
  });

  drawCustomerCard(doc, {
    name: customerName,
    taxId: customerTaxId,
    address: addressLine,
  });

  // Tiles fechas/horas (decisión usuario 2026-05-11):
  // - Fecha programada (SIN HORA)
  // - Fecha + hora de inicio
  // - Hora finalización (con fecha en sub)
  // - Duración
  drawTiles(doc, [
    {
      label: "Fecha programada",
      value: fmtDateOnly(i.scheduled_at),
    },
    {
      label: "Inicio",
      value: fmtDateOnly(i.started_at),
      sub: i.started_at ? fmtTimeOnly(i.started_at) : undefined,
    },
    {
      label: "Finalización",
      value: i.completed_at ? fmtTimeOnly(i.completed_at) : "—",
      sub: i.completed_at ? fmtDateOnly(i.completed_at) : undefined,
      tone: i.completed_at ? "success" : "info",
    },
    {
      label: "Duración",
      value: fmtDurationSec(i.duration_seconds),
    },
  ]);

  // Geolocalización (decisión usuario)
  if (i.started_geo_lat != null && i.started_geo_lng != null) {
    const coords = `${i.started_geo_lat.toFixed(6)}, ${i.started_geo_lng.toFixed(6)}`;
    const distRow: [string, string, "ok" | "warn"] =
      i.geo_distance_to_address_m != null
        ? [
            "Distancia GPS a la dirección registrada",
            `${Math.round(i.geo_distance_to_address_m)} m`,
            i.geo_distance_to_address_m > 300 ? "warn" : "ok",
          ]
        : ["Distancia GPS a la dirección registrada", "—", "ok"];
    drawCallout(doc, {
      title: "GEOLOCALIZACIÓN DE LA INSTALACIÓN",
      rows: [["Coordenadas GPS (inicio del parte)", coords, "ok"], distRow],
    });
  }

  // Estado inicial del lugar
  drawCallout(doc, {
    title: "ESTADO INICIAL DEL LUGAR",
    rows: [
      [
        "Daños previos detectados",
        i.has_previous_damage ? "SÍ" : "NO",
        i.has_previous_damage ? "warn" : "ok",
      ],
      [
        "Requiere agujero en encimera",
        i.needs_countertop_drilling ? "SÍ" : "NO",
        i.needs_countertop_drilling ? "warn" : "ok",
      ],
    ],
  });

  // Equipo instalado
  if (itemList.length > 0) {
    drawSection(doc, `EQUIPO INSTALADO (${itemList.length})`);
    drawEquipmentCards(
      doc,
      itemList.map((it) => ({
        name: productNames.get(it.product_id) ?? "—",
        quantity: it.quantity,
        serial: it.serial_number,
        notes: it.notes,
      })),
    );
  }

  // Notas
  if (i.notes && i.notes.trim().length > 0) {
    drawSection(doc, "OBSERVACIONES DEL TÉCNICO");
    const lines = wrap(doc.font, i.notes, 10, CONTENT_W);
    for (const ln of lines) {
      ensure(doc, 14);
      doc.page.drawText(ln, {
        x: MARGIN,
        y: doc.cursorY,
        size: 10,
        font: doc.font,
        color: TEXT,
      });
      doc.cursorY -= 13;
    }
    doc.cursorY -= 6;
  }

  // Fotos
  if (photoEmbeds.length > 0) {
    drawSection(doc, `FOTOS ADJUNTAS (${photoEmbeds.length})`);
    drawPhotoGrid(doc, photoEmbeds);
  }

  // Firmas (decisión usuario: firma instalador + firma cliente)
  drawSection(doc, "FIRMAS");
  drawSignatures(doc, {
    installer: {
      name: installerSig?.signer_name ?? installerName,
      signedDate: installerSig ? fmtDateTimeShort(installerSig.signed_at) : null,
      image: installerSigImage,
    },
    customer: {
      name: customerSig?.signer_name ?? customerName,
      taxId: customerSig?.signer_tax_id ?? customerTaxId,
      signedDate: customerSig ? fmtDateTimeShort(customerSig.signed_at) : null,
      image: customerSigImage,
    },
  });

  drawFooters(doc, {
    companyName,
    refCode: i.reference_code ?? `#${i.id.slice(0, 8)}`,
    startedAt: i.started_at,
    completedAt: i.completed_at,
  });

  return await doc.pdf.save();
}
