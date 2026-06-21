/**
 * Plantilla de ficha técnica "IAGUA" (diseño infinityaqua).
 *
 * Página 1 (técnica) — reproducida fielmente desde los datos del producto:
 *   logo + regla de acento · título (con palabra destacada en acento) ·
 *   subtítulo (marketing_claim) · hero azul marino con texto + foto ·
 *   4 tarjetas de características · tabla de ficha técnica (atributos visibles) ·
 *   recuadro inferior con badge + descripción · pie con paginación.
 *
 * Página 2 (ventajas) — SOLO si el producto tiene contenido editable en
 *   products.datasheet_extra (why[] / ideal[]): "por qué elegir" + "ideal para".
 *   Sin ilustraciones a medida (iconos simples), todo editable por empresa.
 *
 * Colores: base (azul marino) = company_settings.pdf_brand_color;
 *   acento = products.datasheet_color_accent (override) ?? company_settings.pdf_accent_color.
 *
 * El route handler elige esta plantilla cuando company_settings.datasheet_template
 * = 'iagua'. NO sustituye a datasheet-pdf-v2 (estándar).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { withSanitizer } from "@/shared/lib/pdf/dashstack";
import { createAdminClient } from "@/shared/lib/supabase/admin";

// ===========================================================================
// Layout / colores base
// ===========================================================================
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 44;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const WHITE = rgb(1, 1, 1);
const TEXT = rgb(0.12, 0.15, 0.22);
const MUTED = rgb(0.46, 0.51, 0.59);
const BORDER = rgb(0.88, 0.91, 0.95);

const DEFAULT_NAVY = "#1F3A5F";
const DEFAULT_ACCENT = "#C9A227";

function hexToRgb(hex: string | null | undefined, fallback: string): RGB {
  const src = hex && /^#?[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(src.trim());
  const v = parseInt(m![1]!, 16);
  return rgb(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

/** Mezcla con blanco (amount 0..1) para fondos suaves. */
function tint(c: RGB, amount: number): RGB {
  return rgb(
    c.red + (1 - c.red) * amount,
    c.green + (1 - c.green) * amount,
    c.blue + (1 - c.blue) * amount,
  );
}

function wrapText(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        if (cur) out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    if (words.length === 0) out.push("");
  }
  return out;
}

// ===========================================================================
// Tipos de datos
// ===========================================================================
interface AttrValue {
  name: string;
  unit: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  data_type: string;
  is_featured: boolean;
}

interface DatasheetExtra {
  title_accent?: string;
  hero_heading?: string;
  hero_text?: string;
  features?: Array<{ title?: string; desc?: string }>;
  badge?: { label?: string; desc?: string };
  page2_title?: string;
  why?: string[];
  ideal?: Array<{ title?: string; desc?: string }>;
}

function attrValue(a: AttrValue): string {
  if (a.data_type === "boolean") return a.value_boolean ? "Sí" : "No";
  if (a.data_type === "number" || a.data_type === "dimension") {
    if (a.value_number == null) return "—";
    const n = new Intl.NumberFormat("es-ES").format(a.value_number);
    return `${n}${a.unit ? " " + a.unit : ""}`;
  }
  return a.value_text ?? "—";
}

function attrHasValue(a: AttrValue): boolean {
  if (a.data_type === "boolean") return a.value_boolean != null;
  if (a.data_type === "number" || a.data_type === "dimension") return a.value_number != null;
  return !!a.value_text && a.value_text.trim().length > 0;
}

// ===========================================================================
// Generador
// ===========================================================================
export async function generateProductDatasheetIagua(
  productId: string,
): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ---- 1) Producto (defensivo) ----
  let prod: Record<string, unknown> | null = null;
  {
    const cols =
      "id, company_id, name, short_description, long_description, internal_reference, main_image_url, category_id, marketing_claim, manufacturer_name, manufacturer_model, datasheet_color_accent, datasheet_extra";
    const basic =
      "id, company_id, name, short_description, long_description, internal_reference, main_image_url, category_id";
    const r1 = await admin.from("products").select(cols).eq("id", productId).maybeSingle();
    if (r1.error) {
      const r2 = await admin.from("products").select(basic).eq("id", productId).maybeSingle();
      prod = r2.data ?? null;
    } else {
      prod = r1.data ?? null;
    }
  }
  if (!prod) throw new Error("Producto no encontrado");
  const p = prod as {
    company_id: string;
    name: string;
    short_description: string | null;
    long_description: string | null;
    internal_reference: string | null;
    main_image_url: string | null;
    category_id: string | null;
    marketing_claim: string | null;
    manufacturer_name: string | null;
    manufacturer_model: string | null;
    datasheet_color_accent: string | null;
    datasheet_extra: DatasheetExtra | null;
  };
  const extra: DatasheetExtra = (p.datasheet_extra as DatasheetExtra | null) ?? {};

  // ---- 2) Ajustes de empresa (colores + logo + nombre) ----
  const { data: cs } = await admin
    .from("company_settings")
    .select("pdf_brand_color, pdf_accent_color, fiscal_logo_url, fiscal_legal_name")
    .eq("company_id", p.company_id)
    .maybeSingle();
  const settings = (cs ?? {}) as {
    pdf_brand_color: string | null;
    pdf_accent_color: string | null;
    fiscal_logo_url: string | null;
    fiscal_legal_name: string | null;
  };
  let companyName = settings.fiscal_legal_name ?? "";
  if (!companyName) {
    const { data: comp } = await admin
      .from("companies")
      .select("name")
      .eq("id", p.company_id)
      .maybeSingle();
    companyName = (comp as { name: string } | null)?.name ?? "Empresa";
  }

  const NAVY = hexToRgb(settings.pdf_brand_color, DEFAULT_NAVY);
  const ACCENT = hexToRgb(p.datasheet_color_accent ?? settings.pdf_accent_color, DEFAULT_ACCENT);
  const SOFT = tint(NAVY, 0.93);

  // ---- 3) Atributos visibles ----
  let attrs: AttrValue[] = [];
  try {
    const { data: rows } = await admin
      .from("product_attribute_values")
      .select(
        "is_featured, value_text, value_number, value_boolean, data_type, display_order, product_attributes ( name, unit )",
      )
      .eq("product_id", productId)
      .eq("is_visible", true)
      .order("display_order");
    type Row = {
      is_featured: boolean;
      value_text: string | null;
      value_number: number | null;
      value_boolean: boolean | null;
      data_type: string;
      product_attributes: { name: string; unit: string | null } | null;
    };
    attrs = ((rows ?? []) as Row[])
      .map<AttrValue>((r) => ({
        name: r.product_attributes?.name ?? "",
        unit: r.product_attributes?.unit ?? null,
        value_text: r.value_text,
        value_number: r.value_number,
        value_boolean: r.value_boolean,
        data_type: r.data_type,
        is_featured: r.is_featured,
      }))
      .filter((a) => a.name && attrHasValue(a));
  } catch {
    /* fail-soft */
  }

  // ---- 4) Certificaciones (para el badge inferior) ----
  let certName: string | null = null;
  let certKey: string | null = null;
  try {
    const { data: rows } = await admin
      .from("product_certifications")
      .select("certification_key, certifications_catalog ( name_es )")
      .eq("product_id", productId)
      .order("display_order")
      .limit(1);
    const first = ((rows ?? []) as Array<{
      certification_key: string;
      certifications_catalog: { name_es: string } | null;
    }>)[0];
    if (first) {
      certKey = first.certification_key;
      certName = first.certifications_catalog?.name_es ?? first.certification_key;
    }
  } catch {
    /* fail-soft */
  }

  // ---- 5) PDF ----
  const pdf = await PDFDocument.create();
  const font = withSanitizer(await pdf.embedFont(StandardFonts.Helvetica));
  const bold = withSanitizer(await pdf.embedFont(StandardFonts.HelveticaBold));

  // Logo (se incrusta una vez y se reutiliza en cada página)
  let logoImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (settings.fiscal_logo_url) {
    try {
      const res = await fetch(settings.fiscal_logo_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      logoImg = settings.fiscal_logo_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
    } catch {
      /* fail-soft */
    }
  }

  // Foto del producto
  let photoImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (p.main_image_url) {
    try {
      const res = await fetch(p.main_image_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const url = p.main_image_url.toLowerCase();
      photoImg =
        url.includes(".png") || url.includes("png")
          ? await pdf.embedPng(buf)
          : await pdf.embedJpg(buf);
    } catch {
      try {
        const res = await fetch(p.main_image_url);
        const buf = new Uint8Array(await res.arrayBuffer());
        photoImg = await pdf.embedJpg(buf);
      } catch {
        /* fail-soft */
      }
    }
  }

  const hasPage2 =
    (Array.isArray(extra.why) && extra.why.length > 0) ||
    (Array.isArray(extra.ideal) && extra.ideal.length > 0);
  const totalPages = hasPage2 ? 2 : 1;

  // -- helper: cabecera (logo + regla acento) --
  function drawHeader(page: PDFPage): number {
    const topY = PAGE_H - MARGIN;
    if (logoImg) {
      const h = 30;
      const ratio = logoImg.width / logoImg.height;
      page.drawImage(logoImg, { x: MARGIN, y: topY - h, width: h * ratio, height: h });
    } else {
      page.drawText(companyName.toUpperCase(), {
        x: MARGIN,
        y: topY - 18,
        size: 13,
        font: bold,
        color: NAVY,
      });
    }
    // Regla de acento bajo el logo
    page.drawRectangle({
      x: MARGIN,
      y: topY - 40,
      width: 54,
      height: 3,
      color: ACCENT,
    });
    return topY - 60;
  }

  // -- helper: pie con paginación --
  function drawFooter(page: PDFPage, pageNo: number) {
    page.drawLine({
      start: { x: MARGIN, y: 52 },
      end: { x: PAGE_W - MARGIN, y: 52 },
      thickness: 0.7,
      color: BORDER,
    });
    const label = `${p.name} · Página ${pageNo} de ${totalPages}`;
    page.drawText(label, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(label, 7.5),
      y: 40,
      size: 7.5,
      font,
      color: MUTED,
    });
  }

  // -- helper: cabecera de sección (barra acento + título) --
  function sectionHeader(page: PDFPage, y: number, label: string): number {
    page.drawRectangle({ x: MARGIN, y: y - 1, width: 4, height: 13, color: ACCENT });
    page.drawText(label.toUpperCase(), {
      x: MARGIN + 12,
      y,
      size: 11,
      font: bold,
      color: NAVY,
    });
    return y - 22;
  }

  // ======================= PÁGINA 1 =======================
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = drawHeader(page);

  // Título con palabra destacada en acento
  {
    const size = 23;
    const accentPart = extra.title_accent && p.name.includes(extra.title_accent)
      ? extra.title_accent
      : null;
    if (accentPart) {
      const before = p.name.slice(0, p.name.indexOf(accentPart));
      page.drawText(before, { x: MARGIN, y: y - size, size, font: bold, color: NAVY });
      const bx = MARGIN + bold.widthOfTextAtSize(before, size);
      page.drawText(accentPart, { x: bx, y: y - size, size, font: bold, color: ACCENT });
    } else {
      const lines = wrapText(bold, p.name, size, CONTENT_W).slice(0, 2);
      let ty = y;
      for (const line of lines) {
        page.drawText(line, { x: MARGIN, y: ty - size, size, font: bold, color: NAVY });
        ty -= size + 4;
      }
      y = ty + size; // ajustar
    }
    y -= size + 8;
  }

  // Subtítulo
  if (p.marketing_claim) {
    const lines = wrapText(font, p.marketing_claim, 10.5, CONTENT_W).slice(0, 2);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size: 10.5, font, color: MUTED });
      y -= 14;
    }
  }
  y -= 12;

  // ---- Hero: caja navy (izq) + foto (der) ----
  const heroH = 150;
  const heroY = y - heroH;
  const photoW = photoImg ? 175 : 0;
  const heroBoxW = CONTENT_W - (photoImg ? photoW + 14 : 0);
  page.drawRectangle({
    x: MARGIN,
    y: heroY,
    width: heroBoxW,
    height: heroH,
    color: NAVY,
  });
  // Acento decorativo (barra superior dentro del hero)
  page.drawRectangle({ x: MARGIN, y: heroY + heroH - 5, width: heroBoxW, height: 5, color: ACCENT });
  {
    const padX = 18;
    let hy = heroY + heroH - 26;
    const heading = (extra.hero_heading ?? p.marketing_claim ?? "AGUA DE CALIDAD").toUpperCase();
    for (const line of wrapText(bold, heading, 12.5, heroBoxW - 2 * padX).slice(0, 3)) {
      page.drawText(line, { x: MARGIN + padX, y: hy, size: 12.5, font: bold, color: WHITE });
      hy -= 16;
    }
    hy -= 6;
    const bodyTxt = extra.hero_text ?? p.long_description ?? p.short_description ?? "";
    for (const line of wrapText(font, bodyTxt, 9, heroBoxW - 2 * padX).slice(0, 6)) {
      page.drawText(line, { x: MARGIN + padX, y: hy, size: 9, font, color: tint(NAVY, 0.78) });
      hy -= 12;
    }
  }
  if (photoImg) {
    const panelX = MARGIN + heroBoxW + 14;
    page.drawRectangle({ x: panelX, y: heroY, width: photoW, height: heroH, color: tint(NAVY, 0.95) });
    const maxW = photoW - 22;
    const maxH = heroH - 22;
    const ratio = photoImg.width / photoImg.height;
    let dw = maxW;
    let dh = dw / ratio;
    if (dh > maxH) {
      dh = maxH;
      dw = dh * ratio;
    }
    page.drawImage(photoImg, {
      x: panelX + (photoW - dw) / 2,
      y: heroY + (heroH - dh) / 2,
      width: dw,
      height: dh,
    });
  }
  y = heroY - 26;

  // ---- Características (4 tarjetas 2×2) ----
  const featureSrc: Array<{ title: string; desc: string }> =
    extra.features && extra.features.length > 0
      ? extra.features.slice(0, 4).map((f) => ({ title: f.title ?? "", desc: f.desc ?? "" }))
      : attrs
          .filter((a) => a.is_featured)
          .slice(0, 4)
          .map((a) => ({ title: a.name, desc: attrValue(a) }));
  if (featureSrc.length > 0) {
    y = sectionHeader(page, y, "Características del equipo");
    const gap = 12;
    const cardW = (CONTENT_W - gap) / 2;
    const cardH = 56;
    for (let i = 0; i < featureSrc.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = MARGIN + col * (cardW + gap);
      const cy = y - row * (cardH + gap) - cardH;
      page.drawRectangle({ x: cx, y: cy, width: cardW, height: cardH, color: SOFT });
      page.drawRectangle({ x: cx, y: cy, width: 3, height: cardH, color: ACCENT });
      const f = featureSrc[i]!;
      page.drawText(f.title.toUpperCase(), {
        x: cx + 14,
        y: cy + cardH - 18,
        size: 8.5,
        font: bold,
        color: NAVY,
      });
      let dy = cy + cardH - 32;
      for (const line of wrapText(font, f.desc, 8, cardW - 24).slice(0, 2)) {
        page.drawText(line, { x: cx + 14, y: dy, size: 8, font, color: MUTED });
        dy -= 10;
      }
    }
    const rows = Math.ceil(featureSrc.length / 2);
    y -= rows * (cardH + gap) + 14;
  }

  // ---- Ficha técnica (tabla 2 columnas) ----
  if (attrs.length > 0) {
    const refTxt = p.internal_reference ? ` — ${p.internal_reference} · ${p.name}` : "";
    y = sectionHeader(page, y, `Ficha técnica${refTxt}`);
    const colGap = 22;
    const colW = (CONTENT_W - colGap) / 2;
    const half = Math.ceil(attrs.length / 2);
    const cols = [attrs.slice(0, half), attrs.slice(half)];
    const rowH = 18;
    for (let c = 0; c < 2; c++) {
      const colX = MARGIN + c * (colW + colGap);
      let ry = y;
      cols[c]!.forEach((a, idx) => {
        if (idx % 2 === 0) {
          page.drawRectangle({ x: colX, y: ry - 4, width: colW, height: rowH, color: tint(NAVY, 0.965) });
        }
        page.drawText(a.name, { x: colX + 6, y: ry, size: 8.5, font: bold, color: NAVY });
        const v = attrValue(a);
        page.drawText(v, {
          x: colX + colW - 6 - font.widthOfTextAtSize(v, 8.5),
          y: ry,
          size: 8.5,
          font,
          color: TEXT,
        });
        ry -= rowH;
      });
    }
    y -= half * rowH + 16;
  }

  // ---- Recuadro inferior: badge + descripción ----
  {
    const badgeLabel = extra.badge?.label ?? (certKey ? certKey.toUpperCase().slice(0, 12) : null);
    const badgeDesc =
      extra.badge?.desc ??
      (certName
        ? `Producto certificado ${certName}.`
        : p.long_description ?? p.short_description ?? null);
    if (badgeLabel || badgeDesc) {
      const boxH = 56;
      const boxY = Math.max(70, y - boxH);
      page.drawRectangle({
        x: MARGIN,
        y: boxY,
        width: CONTENT_W,
        height: boxH,
        color: tint(NAVY, 0.95),
        borderColor: tint(NAVY, 0.8),
        borderWidth: 0.8,
      });
      let textX = MARGIN + 16;
      if (badgeLabel) {
        const bw = 56;
        page.drawRectangle({ x: MARGIN + 12, y: boxY + (boxH - 40) / 2, width: bw, height: 40, color: NAVY });
        const bl = wrapText(bold, badgeLabel, 8, bw - 8).slice(0, 3);
        let by = boxY + (boxH - 40) / 2 + 40 - 12;
        for (const line of bl) {
          page.drawText(line, {
            x: MARGIN + 12 + (bw - bold.widthOfTextAtSize(line, 8)) / 2,
            y: by,
            size: 8,
            font: bold,
            color: WHITE,
          });
          by -= 10;
        }
        textX = MARGIN + 12 + bw + 14;
      }
      if (badgeDesc) {
        const availW = MARGIN + CONTENT_W - textX - 12;
        const lines = wrapText(font, badgeDesc, 8.5, availW).slice(0, 4);
        let dy = boxY + boxH - 16;
        lines.forEach((line, i) => {
          page.drawText(line, {
            x: textX,
            y: dy,
            size: 8.5,
            font: i === 0 ? bold : font,
            color: i === 0 ? ACCENT : TEXT,
          });
          dy -= 11;
        });
      }
    }
  }

  drawFooter(page, 1);

  // ======================= PÁGINA 2 =======================
  if (hasPage2) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = drawHeader(page);
    y = sectionHeader(page, y, extra.page2_title ?? "Por qué elegir este equipo");

    // Por qué elegir (2 columnas con check de acento)
    if (extra.why && extra.why.length > 0) {
      const colGap = 24;
      const colW = (CONTENT_W - colGap) / 2;
      const items = extra.why.slice(0, 10);
      const half = Math.ceil(items.length / 2);
      const cols = [items.slice(0, half), items.slice(half)];
      let maxRowsY = y;
      for (let c = 0; c < 2; c++) {
        const colX = MARGIN + c * (colW + colGap);
        let ry = y;
        for (const it of cols[c]!) {
          // Marcador (cuadradito de acento; "✓" no existe en WinAnsi).
          page.drawRectangle({ x: colX, y: ry, width: 7, height: 7, color: ACCENT });
          const lines = wrapText(font, it, 9.5, colW - 18);
          let ly = ry;
          for (const line of lines) {
            page.drawText(line, { x: colX + 16, y: ly, size: 9.5, font, color: TEXT });
            ly -= 12;
          }
          ry = ly - 6;
        }
        if (ry < maxRowsY) maxRowsY = ry;
      }
      y = maxRowsY - 10;
    }

    // Ideal para (tarjetas)
    if (extra.ideal && extra.ideal.length > 0) {
      y = sectionHeader(page, y, "Ideal para");
      const gap = 12;
      const cardW = (CONTENT_W - gap) / 2;
      const cardH = 54;
      const list = extra.ideal.slice(0, 6);
      for (let i = 0; i < list.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = MARGIN + col * (cardW + gap);
        const cy = y - row * (cardH + gap) - cardH;
        page.drawRectangle({ x: cx, y: cy, width: cardW, height: cardH, color: SOFT });
        page.drawRectangle({ x: cx, y: cy, width: 3, height: cardH, color: ACCENT });
        const it = list[i]!;
        page.drawText((it.title ?? "").toUpperCase(), {
          x: cx + 14,
          y: cy + cardH - 18,
          size: 8.5,
          font: bold,
          color: NAVY,
        });
        let dy = cy + cardH - 32;
        for (const line of wrapText(font, it.desc ?? "", 8, cardW - 24).slice(0, 2)) {
          page.drawText(line, { x: cx + 14, y: dy, size: 8, font, color: MUTED });
          dy -= 10;
        }
      }
    }

    drawFooter(page, 2);
  }

  return pdf.save();
}
