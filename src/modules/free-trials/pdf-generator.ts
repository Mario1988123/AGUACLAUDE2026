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
import { requireSession } from "@/shared/lib/auth/session";
import { DEFAULT_FREE_TRIAL_CONDITIONS } from "@/modules/config/free-trials/defaults";

// ============================================================================
// Constantes de diseño (clonadas del PDF de contrato para coherencia visual)
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
  if (d.cursorY - needed < 60) newPage(d);
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

function fmtDateLong(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDateShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES");
}

/**
 * Sustituye placeholders aceptando {var}, [var], {{var}} y mayúsculas.
 */
function applyPlaceholders(template: string, data: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(data)) {
    const v = String(value);
    out = out.split(`{{${key}}}`).join(v);
    out = out.split(`{${key}}`).join(v);
    out = out.split(`[${key}]`).join(v);
    out = out.split(`{${key.toUpperCase()}}`).join(v);
    out = out.split(`[${key.toUpperCase()}]`).join(v);
  }
  return out;
}

/**
 * Parsea texto de condiciones en cláusulas estructuradas.
 * Detecta "1. Título" o líneas en MAYÚSCULAS como inicio de cláusula.
 */
function parseClauses(text: string): Array<{ title: string; body: string }> {
  const lines = text.split(/\n/);
  const clauses: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  const numberedRe = /^\s*(\d+)[.)]\s+(.+)$/;
  const upperRe = /^\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\d/().,:;-]{4,80})\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      if (current) current.body += "\n";
      continue;
    }
    const numberedMatch = line.match(numberedRe);
    const upperMatch = !numberedMatch && line.match(upperRe);
    if (numberedMatch) {
      if (current) clauses.push(current);
      const rest = numberedMatch[2]!.trim();
      const dot = rest.indexOf(". ");
      let title: string;
      let body: string;
      if (dot > 0 && dot < 80) {
        title = rest.slice(0, dot).trim();
        body = rest.slice(dot + 2).trim();
      } else if (rest.length <= 60) {
        title = rest;
        body = "";
      } else {
        const words = rest.split(/\s+/);
        title = words.slice(0, 5).join(" ");
        body = words.slice(5).join(" ");
      }
      current = { title, body };
    } else if (upperMatch && (!current || current.body.length > 50)) {
      if (current) clauses.push(current);
      current = { title: upperMatch[1]!.trim(), body: "" };
    } else {
      if (!current) {
        current = { title: "Condiciones generales", body: line };
      } else {
        current.body += (current.body ? "\n" : "") + line;
      }
    }
  }
  if (current) clauses.push(current);
  return clauses
    .map((c) => ({ title: c.title, body: c.body.trim() }))
    .filter((c) => c.title.length > 0);
}

// ============================================================================
// Componentes visuales
// ============================================================================
function drawHeader(
  d: Doc,
  opts: {
    refCode: string;
    dateLabel: string;
    statusBadge: { label: string; tone: "warn" | "success" };
    companyName: string;
    companyTaxId: string | null;
    companyContact: string | null;
  },
): void {
  d.page.drawRectangle({ x: 0, y: PAGE_H - 12, width: PAGE_W, height: 12, color: TEAL });
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
  const refTxt = `Ref. ${opts.refCode}`;
  const rw = d.bold.widthOfTextAtSize(refTxt, 10);
  d.page.drawText(refTxt, {
    x: PAGE_W - MARGIN - rw,
    y: PAGE_H - 35,
    size: 10,
    font: d.bold,
    color: TEAL_DARK,
  });
  const dw = d.font.widthOfTextAtSize(opts.dateLabel, 9);
  d.page.drawText(opts.dateLabel, {
    x: PAGE_W - MARGIN - dw,
    y: PAGE_H - 50,
    size: 9,
    font: d.font,
    color: MUTED,
  });
  // Badge estado
  const bg = opts.statusBadge.tone === "warn" ? WARN_BG : SUCCESS_BG;
  const txt = opts.statusBadge.tone === "warn" ? WARN_TXT : SUCCESS;
  const bw = d.bold.widthOfTextAtSize(opts.statusBadge.label, 8) + 14;
  d.page.drawRectangle({
    x: PAGE_W - MARGIN - bw,
    y: PAGE_H - 70,
    width: bw,
    height: 14,
    color: bg,
    borderColor: bg,
  });
  d.page.drawText(opts.statusBadge.label, {
    x: PAGE_W - MARGIN - bw + 7,
    y: PAGE_H - 67,
    size: 8,
    font: d.bold,
    color: txt,
  });
  // Título centrado
  const title = "ALBARÁN DE ENTREGA";
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
  d.page.drawRectangle({
    x: PAGE_W / 2 - 30,
    y: titleY - 8,
    width: 60,
    height: 3,
    color: TEAL,
  });
  const sub = "Equipo en depósito provisional para periodo de prueba";
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
    ["Dirección de entrega", customer.address ?? "—"],
  ];
  if (customer.phone) rows.push(["Teléfono", customer.phone]);
  if (customer.email) rows.push(["Email", customer.email]);
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
  d.page.drawText("DATOS DEL CLIENTE", {
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
    const lines = wrap(d.bold, r[1], 9.5, CONTENT_W - padding * 2 - 130);
    d.page.drawText(lines[0] ?? "—", {
      x: MARGIN + padding + 130,
      y,
      size: 9.5,
      font: d.bold,
      color: TEXT,
    });
  });
  d.cursorY = top - cardH - 16;
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
  items: Array<{ name: string; quantity: number; serial: string | null }>,
): void {
  for (const it of items) {
    ensure(d, 50);
    const cardH = 44;
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
      color: TEAL,
    });
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
    const nameLines = wrap(d.bold, it.name, 11, CONTENT_W - 200);
    d.page.drawText(nameLines[0] ?? "—", {
      x: MARGIN + 12 + qw + 26,
      y: top - 22,
      size: 11,
      font: d.bold,
      color: TEXT,
    });
    if (it.serial) {
      d.page.drawText(`S/N: ${it.serial}`, {
        x: MARGIN + 12 + qw + 26,
        y: top - 35,
        size: 9,
        font: d.font,
        color: MUTED,
      });
    }
    d.cursorY = top - cardH - 8;
  }
}

function drawCallout(
  d: Doc,
  opts: { title: string; rows: Array<[string, string]>; tone?: "info" | "warn" },
): void {
  const padding = 14;
  const lineH = 16;
  const bg = opts.tone === "warn" ? WARN_BG : TEAL_LIGHT;
  const border = opts.tone === "warn" ? WARN_TXT : TEAL;
  const titleColor = opts.tone === "warn" ? WARN_TXT : TEAL_DARK;
  const blockH = 28 + opts.rows.length * lineH + padding;
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
  d.page.drawText(opts.title, {
    x: MARGIN + padding,
    y: top - 18,
    size: 10,
    font: d.bold,
    color: titleColor,
  });
  opts.rows.forEach((r, i) => {
    const y = top - 36 - i * lineH;
    d.page.drawText(`${r[0]}:`, {
      x: MARGIN + padding,
      y,
      size: 9,
      font: d.font,
      color: MUTED,
    });
    d.page.drawText(r[1], {
      x: MARGIN + padding + 130,
      y,
      size: 10,
      font: d.bold,
      color: TEXT,
    });
  });
  d.cursorY = top - blockH - 14;
}

function drawClauses(d: Doc, clauses: Array<{ title: string; body: string }>): void {
  clauses.forEach((c, i) => {
    ensure(d, 50);
    d.cursorY -= 16;
    const numTxt = String(i + 1);
    const numW = d.bold.widthOfTextAtSize(numTxt, 10);
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
    d.page.drawText(c.title, {
      x: MARGIN + 28,
      y: d.cursorY,
      size: 10.5,
      font: d.bold,
      color: TEXT,
    });
    d.cursorY -= 14;
    if (c.body) {
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
    }
    d.cursorY -= 8;
  });
}

function drawSignatures(
  d: Doc,
  opts: {
    company: { name: string; signatureImage?: PDFImage | null; signedDate: string | null };
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

function drawFooters(
  d: Doc,
  opts: { companyName: string; refCode: string; generatedAt: string; signedAt: string | null },
): void {
  const pages = d.pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawLine({
      start: { x: MARGIN, y: 38 },
      end: { x: PAGE_W - MARGIN, y: 38 },
      thickness: 0.3,
      color: BORDER,
    });
    p.drawText(opts.companyName, {
      x: MARGIN,
      y: 24,
      size: 7.5,
      font: d.bold,
      color: MUTED,
    });
    const center = `Albarán ${opts.refCode}`;
    const cw = d.font.widthOfTextAtSize(center, 7.5);
    p.drawText(center, {
      x: PAGE_W / 2 - cw / 2,
      y: 24,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
    const pageTxt = `Pág. ${idx + 1} / ${pages.length}`;
    const pw = d.font.widthOfTextAtSize(pageTxt, 7.5);
    p.drawText(pageTxt, {
      x: PAGE_W - MARGIN - pw,
      y: 24,
      size: 7.5,
      font: d.font,
      color: MUTED,
    });
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

async function fetchSignature(
  pdf: PDFDocument,
  storagePath: string | null,
): Promise<PDFImage | null> {
  if (!storagePath) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin.storage.from("free-trial-signatures").download(storagePath);
    if (error || !data) return null;
    const ab = await (data as Blob).arrayBuffer();
    try {
      return await pdf.embedPng(new Uint8Array(ab));
    } catch {
      try {
        return await pdf.embedJpg(new Uint8Array(ab));
      } catch {
        return null;
      }
    }
  } catch (e) {
    console.error("[fetchSignature] failed:", e);
    return null;
  }
}

// ============================================================================
// Generador principal
// ============================================================================
export async function generateFreeTrialDeliveryNotePdf(
  trialId: string,
): Promise<Uint8Array> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SELECT defensivo: si PostgREST tiene cache obsoleto y no ve alguna
  // columna de firma, cargamos solo lo core y dejamos los paths/nombres
  // en null. El PDF saldrá sin firmas pero al menos no peta.
  const FULL_COLS =
    "id, reference_code, status, duration_days, conditions_text, installed_at, expires_at, scheduled_at, created_at, installation_address_id, customer_id, lead_id, customer_signature_path, customer_signer_name, customer_signer_tax_id, customer_signed_at, representative_signature_path, representative_user_id, representative_signed_at";
  const CORE_COLS =
    "id, reference_code, status, duration_days, conditions_text, installed_at, expires_at, scheduled_at, created_at, installation_address_id, customer_id, lead_id";
  let trialRes = await admin
    .from("free_trials")
    .select(FULL_COLS)
    .eq("id", trialId)
    .maybeSingle();
  if (
    trialRes.error &&
    /(does not exist|schema cache|Could not find)/i.test(
      trialRes.error.message ?? "",
    )
  ) {
    console.warn(
      "[generateFreeTrialPdf] cache obsoleto, cargando sin columnas de firma:",
      trialRes.error.message,
    );
    trialRes = await admin
      .from("free_trials")
      .select(CORE_COLS)
      .eq("id", trialId)
      .maybeSingle();
  }
  const trialRow = trialRes.data;
  if (!trialRow) throw new Error("Prueba no encontrada");
  const trial = trialRow as {
    id: string;
    reference_code: string | null;
    status: string;
    duration_days: number;
    conditions_text: string | null;
    installed_at: string | null;
    expires_at: string | null;
    scheduled_at: string | null;
    created_at: string;
    installation_address_id: string | null;
    customer_id: string | null;
    lead_id: string | null;
    // Estas son opcionales (no se cargan si cache obsoleto)
    customer_signature_path?: string | null;
    customer_signer_name?: string | null;
    customer_signer_tax_id?: string | null;
    customer_signed_at?: string | null;
    representative_signature_path?: string | null;
    representative_user_id?: string | null;
    representative_signed_at?: string | null;
  };

  const { data: itemsRows } = await admin
    .from("free_trial_items")
    .select("product_name_snapshot, quantity, serial_number")
    .eq("free_trial_id", trial.id);
  const items = (itemsRows ?? []) as Array<{
    product_name_snapshot: string;
    quantity: number;
    serial_number: string | null;
  }>;

  // Cliente o lead
  let clientName = "Cliente";
  let clientTaxId: string | null = null;
  let clientEmail: string | null = null;
  let clientPhone: string | null = null;
  if (trial.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select(
        "party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
      )
      .eq("id", trial.customer_id)
      .maybeSingle();
    if (c) {
      clientName =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Cliente"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";
      clientTaxId = c.tax_id;
      clientEmail = c.email;
      clientPhone = c.phone_primary;
    }
  } else if (trial.lead_id) {
    const { data: l } = await admin
      .from("leads")
      .select(
        "party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
      )
      .eq("id", trial.lead_id)
      .maybeSingle();
    if (l) {
      clientName =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Cliente"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Cliente";
      clientTaxId = l.tax_id;
      clientEmail = l.email;
      clientPhone = l.phone_primary;
    }
  }

  // Dirección
  let addressStr = "—";
  if (trial.installation_address_id) {
    const { data: a } = await admin
      .from("addresses")
      .select(
        "street_type, street, street_number, portal, floor, door, postal_code, city, province",
      )
      .eq("id", trial.installation_address_id)
      .maybeSingle();
    if (a) {
      addressStr =
        [
          `${a.street_type ?? ""} ${a.street ?? ""} ${a.street_number ?? ""}`.trim(),
          a.portal ? `Portal ${a.portal}` : null,
          a.floor ? `${a.floor}o` : null,
          a.door ? a.door : null,
          a.postal_code,
          a.city,
          a.province,
        ]
          .filter(Boolean)
          .join(", ") || "—";
    }
  }

  // Empresa
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, tax_id")
    .eq("id", session.company_id!)
    .maybeSingle();
  const { data: cs } = await admin
    .from("company_settings")
    .select(
      "contact_email, contact_phone, fiscal_address, fiscal_postal_code, fiscal_city, fiscal_legal_name, fiscal_tax_id, extra",
    )
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const csObj = (cs ?? {}) as {
    contact_email?: string | null;
    contact_phone?: string | null;
    fiscal_address?: string | null;
    fiscal_postal_code?: string | null;
    fiscal_city?: string | null;
    fiscal_legal_name?: string | null;
    fiscal_tax_id?: string | null;
    extra?: Record<string, unknown> | null;
  };
  const companyName = co.trade_name || co.legal_name || csObj.fiscal_legal_name || "Mi Empresa";
  const companyTaxId = co.tax_id ?? csObj.fiscal_tax_id ?? null;
  const companyContact =
    [csObj.contact_phone, csObj.contact_email].filter(Boolean).join(" · ") || null;

  const ftConfig =
    ((csObj.extra as Record<string, unknown> | null)?.free_trials as
      | { conditions_text?: string; default_renting_quote_months?: number }
      | undefined) ?? {};
  const rentingMonths = ftConfig.default_renting_quote_months ?? 48;

  const equipoStr =
    items
      .map(
        (i) =>
          `${i.product_name_snapshot} x${i.quantity}` +
          (i.serial_number ? ` (S/N ${i.serial_number})` : ""),
      )
      .join(", ") || "—";
  const fechaEntrega = trial.installed_at ?? trial.scheduled_at ?? trial.created_at;
  const fechaDevolucion =
    trial.expires_at ??
    (() => {
      const dt = new Date(fechaEntrega);
      dt.setDate(dt.getDate() + trial.duration_days);
      return dt.toISOString();
    })();

  const baseTemplate =
    trial.conditions_text || ftConfig.conditions_text || DEFAULT_FREE_TRIAL_CONDITIONS;
  const conditionsText = applyPlaceholders(baseTemplate, {
    cliente: clientName,
    empresa: companyName,
    equipo: equipoStr,
    direccion: addressStr,
    dias_prueba: trial.duration_days,
    fecha_entrega: fmtDateLong(fechaEntrega),
    fecha_devolucion: fmtDateLong(fechaDevolucion),
    precio_renting_mes: "—",
    duracion_renting: `${rentingMonths} meses`,
  });

  const clauses = parseClauses(conditionsText);

  const doc = await newDoc();
  const today = new Date();
  const repSigImage = await fetchSignature(doc.pdf, trial.representative_signature_path ?? null);
  const custSigImage = await fetchSignature(doc.pdf, trial.customer_signature_path ?? null);
  const isSigned = !!trial.customer_signature_path && !!trial.representative_signature_path;

  drawHeader(doc, {
    refCode: trial.reference_code ?? `#${trial.id.slice(0, 8)}`,
    dateLabel: fmtDateLong(fechaEntrega),
    statusBadge: isSigned
      ? { label: "FIRMADO", tone: "success" }
      : { label: "EN PRUEBA", tone: "warn" },
    companyName,
    companyTaxId,
    companyContact,
  });

  drawCustomerCard(doc, {
    name: clientName,
    taxId: clientTaxId,
    address: addressStr !== "—" ? addressStr : null,
    phone: clientPhone,
    email: clientEmail,
  });

  drawCallout(doc, {
    title: "PLAZOS DE LA PRUEBA",
    rows: [
      ["Fecha de entrega", fmtDateLong(fechaEntrega)],
      ["Duración", `${trial.duration_days} días`],
      ["Fecha tope devolución", fmtDateLong(fechaDevolucion)],
    ],
    tone: "warn",
  });

  drawSection(doc, `EQUIPOS ENTREGADOS (${items.length})`);
  if (items.length === 0) {
    doc.cursorY -= 6;
    doc.page.drawText("Sin equipos asociados al albarán.", {
      x: MARGIN,
      y: doc.cursorY,
      size: 10,
      font: doc.italic,
      color: MUTED,
    });
    doc.cursorY -= 16;
  } else {
    drawEquipmentCards(
      doc,
      items.map((it) => ({
        name: it.product_name_snapshot,
        quantity: it.quantity,
        serial: it.serial_number,
      })),
    );
  }

  drawSection(doc, "CONDICIONES DE LA ENTREGA");
  drawClauses(doc, clauses);

  drawSection(doc, "FIRMAS");
  drawSignatures(doc, {
    company: {
      name: companyName,
      signatureImage: repSigImage,
      signedDate: trial.representative_signed_at
        ? fmtDateShort(trial.representative_signed_at)
        : null,
    },
    customer: {
      name: trial.customer_signer_name ?? clientName,
      taxId: trial.customer_signer_tax_id ?? clientTaxId,
      signatureImage: custSigImage,
      signedDate: trial.customer_signed_at ? fmtDateShort(trial.customer_signed_at) : null,
    },
  });

  drawFooters(doc, {
    companyName,
    refCode: trial.reference_code ?? `#${trial.id.slice(0, 8)}`,
    generatedAt: fmtDateShort(today),
    signedAt: trial.customer_signed_at ? fmtDateShort(trial.customer_signed_at) : null,
  });

  return await doc.pdf.save();
}
