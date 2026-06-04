/**
 * Datasheet PDF v2 — rediseño 2026-06-04 basado en investigación de fichas
 * técnicas reales del sector tratamiento de agua (BWT / Cillit / Pentair /
 * Kinetico / Culligan / Hidrowater / Atlas Filtri / Lenntech).
 *
 * Estructura de página (A4 vertical, 595×842 pt):
 *   1. Banda superior con color corporativo (companies.pdf_brand_color o
 *      override en products.datasheet_color_accent).
 *   2. Logo de empresa + "FICHA TÉCNICA" + SKU + código de la ficha.
 *   3. Foto producto + nombre comercial + marketing_claim + categoría +
 *      fabricante (marca y modelo) + tags como chips.
 *   4. Tabla de especificaciones técnicas agrupada en secciones:
 *      Hidráulico / Rendimiento / Consumibles / Eléctrico / Físico.
 *      Solo se incluyen atributos con is_visible=true; las secciones sin
 *      contenido se omiten del PDF.
 *   5. Dibujo isométrico 3D con cotas (si hay dimensiones).
 *   6. Mantenimiento recomendado (lista de filtros que lleva, con
 *      periodicidad de cambio).
 *   7. Garantías por bloque (general / electrónica / carcasa).
 *   8. Certificaciones como chips en línea.
 *   9. Pie con datos de empresa.
 *
 * NO sobrescribe el datasheet-pdf.ts original — se exporta como
 * `generateProductDatasheetV2`. El route handler decide cuál usar.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { createAdminClient } from "@/shared/lib/supabase/admin";

// =============================================================================
// Tipos internos
// =============================================================================

interface ProductRow {
  id: string;
  company_id: string;
  name: string;
  short_description: string | null;
  long_description: string | null;
  internal_reference: string | null;
  supplier_reference: string | null;
  main_image_url: string | null;
  category_id: string | null;
  dim_width_mm: number | null;
  dim_height_mm: number | null;
  dim_depth_mm: number | null;
  weight_grams: number | null;
  // Columnas nuevas (Fase 1)
  tags: string[] | null;
  marketing_claim: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  warranty_months_general: number | null;
  warranty_months_electronics: number | null;
  warranty_months_body: number | null;
  datasheet_color_accent: string | null;
  country_of_origin: string | null;
}

interface AttrValue {
  attribute_key: string;
  attribute_name: string;
  unit: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  data_type: string;
  is_visible: boolean;
  is_featured: boolean;
  display_order: number;
}

interface FiscalInfo {
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_logo_url: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  fiscal_address: string | null;
  fiscal_postal_code: string | null;
}

interface FilterAssignment {
  filter_name: string;
  filter_type: string | null;
  stage_position: number | null;
  replacement_period_months: number | null;
  lifespan_months: number | null;
}

interface CertificationRow {
  certification_key: string;
  name_es: string;
  category: string;
  certificate_number: string | null;
  valid_until: string | null;
}

// =============================================================================
// Constantes layout
// =============================================================================

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

const COLOR_TEXT = rgb(0.1, 0.13, 0.2);
const COLOR_MUTED = rgb(0.45, 0.5, 0.58);
const COLOR_BORDER = rgb(0.9, 0.92, 0.96);
const COLOR_BG_SOFT = rgb(0.96, 0.97, 0.99);
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_SUCCESS = rgb(0.13, 0.59, 0.36);

// Default si la empresa no tiene pdf_brand_color (cumple decisión usuario:
// color del PDF hereda de companies, pero si no hay nada caemos a este azul).
const DEFAULT_BRAND = "#2563EB";

// =============================================================================
// Helpers de color (HEX → pdf-lib RGB)
// =============================================================================

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return rgb(0.16, 0.39, 1);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

// Aclarar / oscurecer un RGB para fondos suaves o textos contraste.
function lighten(c: RGB, amount: number): RGB {
  return rgb(
    Math.min(1, c.red + amount),
    Math.min(1, c.green + amount),
    Math.min(1, c.blue + amount),
  );
}

// =============================================================================
// Formateo valor de atributo
// =============================================================================

function valueAsText(v: AttrValue): string {
  if (v.data_type === "boolean") return v.value_boolean ? "Sí" : "No";
  if (v.data_type === "number" || v.data_type === "dimension") {
    if (v.value_number == null) return "—";
    const n = new Intl.NumberFormat("es-ES").format(v.value_number);
    return `${n}${v.unit ? " " + v.unit : ""}`;
  }
  return v.value_text ?? "—";
}

function hasValue(v: AttrValue): boolean {
  if (v.data_type === "boolean") return v.value_boolean != null;
  if (v.data_type === "number" || v.data_type === "dimension") return v.value_number != null;
  return v.value_text != null && v.value_text.trim().length > 0;
}

// =============================================================================
// Clasificación de atributos por sección (regla por palabra clave del key)
// =============================================================================

type SectionKey = "hydraulic" | "performance" | "consumables" | "electric" | "physical" | "other";

const SECTION_LABEL: Record<SectionKey, string> = {
  hydraulic: "HIDRÁULICO",
  performance: "RENDIMIENTO",
  consumables: "CONSUMIBLES",
  electric: "ELÉCTRICO",
  physical: "FÍSICO",
  other: "OTROS DATOS",
};

const SECTION_ORDER: SectionKey[] = [
  "hydraulic",
  "performance",
  "consumables",
  "electric",
  "physical",
  "other",
];

function classifyAttribute(key: string): SectionKey {
  const k = key.toLowerCase();
  if (
    /pressure|flow|temp_|temperature|connection|inlet|outlet|tank|tap|by_?pass|chamber|capacity|cooling|heating|refrigerant|supply_system|hardness/.test(
      k,
    )
  ) {
    // Caudal, presión, conexiones, refrigerante, depósitos → Hidráulico
    if (/cooling_power|heating_power|refrigerant_charge/.test(k)) return "electric";
    return "hydraulic";
  }
  if (
    /production|rejection|recovery|stages|membrane|media_type|micron|dose|wavelength|generator|sanitization|noise|chlorine_reduction|max_tds|ph_/.test(
      k,
    )
  ) {
    return "performance";
  }
  if (/life|lifespan|prefilter_life|membrane_life|postfilter_life|lamp_life|salt_per_regen|water_per_regen|salt_tank|salt_efficiency/.test(k)) {
    return "consumables";
  }
  if (/voltage|power|frequency|sensor|alarm|energy_class|booster_voltage|booster_power|wifi/.test(k)) {
    return "electric";
  }
  if (/dimensions|weight|material|color|installation_type|tank_material|chamber_material|body_material|filter_size|size_inches/.test(k)) {
    return "physical";
  }
  return "other";
}

// =============================================================================
// Wrapper de texto multilínea
// =============================================================================

function wrapText(font: PDFFont, text: string, size: number, maxW: number): string[] {
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
  return lines;
}

// =============================================================================
// Isométrico 3D (reutilizado conceptualmente del v1)
// =============================================================================

function drawIsoBox(
  page: PDFPage,
  bold: PDFFont,
  centerX: number,
  centerY: number,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  primary: RGB,
) {
  const maxMm = Math.max(widthMm, heightMm, depthMm) || 100;
  const scale = 110 / maxMm;
  const w = widthMm * scale;
  const h = heightMm * scale;
  const d = depthMm * scale;
  const dx = d * Math.cos(Math.PI / 6);
  const dy = d * Math.sin(Math.PI / 6);

  const fillFront = lighten(primary, 0.75);
  const fillTop = lighten(primary, 0.55);
  const fillSide = lighten(primary, 0.4);
  const edge = lighten(primary, -0.2);

  const x = centerX - (w + dx) / 2;
  const y = centerY - (h + dy) / 2;

  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: fillFront,
    borderColor: edge,
    borderWidth: 1,
  });
  page.drawSvgPath(
    `M ${x} ${PAGE_H - (y + h)} L ${x + w} ${PAGE_H - (y + h)} L ${x + w + dx} ${PAGE_H - (y + h + dy)} L ${x + dx} ${PAGE_H - (y + h + dy)} Z`,
    { color: fillTop, borderColor: edge, borderWidth: 1 },
  );
  page.drawSvgPath(
    `M ${x + w} ${PAGE_H - y} L ${x + w} ${PAGE_H - (y + h)} L ${x + w + dx} ${PAGE_H - (y + h + dy)} L ${x + w + dx} ${PAGE_H - (y + dy)} Z`,
    { color: fillSide, borderColor: edge, borderWidth: 1 },
  );

  // Cotas
  const cota = lighten(primary, -0.3);
  const yWidth = y - 14;
  page.drawLine({ start: { x, y: yWidth }, end: { x: x + w, y: yWidth }, thickness: 0.5, color: cota });
  const widthLabel = `${widthMm} mm`;
  const wLabelW = bold.widthOfTextAtSize(widthLabel, 7);
  page.drawText(widthLabel, {
    x: x + w / 2 - wLabelW / 2,
    y: yWidth - 8,
    size: 7,
    font: bold,
    color: COLOR_TEXT,
  });

  const xH = x - 16;
  page.drawLine({ start: { x: xH, y }, end: { x: xH, y: y + h }, thickness: 0.5, color: cota });
  const heightLabel = `${heightMm} mm`;
  page.drawText(heightLabel, {
    x: xH - bold.widthOfTextAtSize(heightLabel, 7) - 4,
    y: y + h / 2 - 3,
    size: 7,
    font: bold,
    color: COLOR_TEXT,
  });

  const depthLabel = `${depthMm} mm`;
  page.drawText(depthLabel, {
    x: x + w + dx + 4,
    y: y + h + dy - h / 2,
    size: 7,
    font: bold,
    color: COLOR_TEXT,
  });
}

// =============================================================================
// Tag chip
// =============================================================================

function drawChip(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  text: string,
  bg: RGB,
  fg: RGB,
  size = 7,
): number {
  const padX = 6;
  const w = font.widthOfTextAtSize(text, size) + padX * 2;
  const h = size + 6;
  page.drawRectangle({ x, y, width: w, height: h, color: bg });
  page.drawText(text, { x: x + padX, y: y + 3, size, font, color: fg });
  return x + w + 4;
}

// =============================================================================
// Entry point
// =============================================================================

export async function generateProductDatasheetV2(productId: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ------------------------------------------------------------------------
  // 1. Cargar datos del producto + empresa + categoría
  // ------------------------------------------------------------------------
  // Selección defensiva: si las columnas nuevas no existen aún (migración no
  // aplicada en alguna BD), volvemos a un select más restringido.
  let prod: ProductRow | null = null;
  {
    const colsFull =
      "id, company_id, name, short_description, long_description, internal_reference, supplier_reference, main_image_url, category_id, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, tags, marketing_claim, manufacturer_name, manufacturer_model, warranty_months_general, warranty_months_electronics, warranty_months_body, datasheet_color_accent, country_of_origin";
    const colsBasic =
      "id, company_id, name, short_description, long_description, internal_reference, supplier_reference, main_image_url, category_id, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams";
    const r1 = await admin.from("products").select(colsFull).eq("id", productId).maybeSingle();
    if (r1.error && /column .* does not exist|schema cache/i.test(r1.error.message ?? "")) {
      const r2 = await admin.from("products").select(colsBasic).eq("id", productId).maybeSingle();
      prod = r2.data ? Object.assign({}, r2.data, {
        tags: null,
        marketing_claim: null,
        manufacturer_name: null,
        manufacturer_model: null,
        warranty_months_general: null,
        warranty_months_electronics: null,
        warranty_months_body: null,
        datasheet_color_accent: null,
        country_of_origin: null,
      }) : null;
    } else {
      prod = r1.data ?? null;
    }
  }
  if (!prod) throw new Error("Producto no encontrado");
  const p = prod;

  // Empresa + fiscal
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, pdf_brand_color")
    .eq("id", p.company_id)
    .maybeSingle();
  const co = (company ?? {}) as {
    legal_name: string | null;
    trade_name: string | null;
    pdf_brand_color: string | null;
  };

  const { data: fiscal } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_email, fiscal_phone, fiscal_logo_url, fiscal_city, fiscal_province, fiscal_address, fiscal_postal_code",
    )
    .eq("company_id", p.company_id)
    .maybeSingle();
  const fi = (fiscal ?? {}) as FiscalInfo;
  const companyName = fi.fiscal_legal_name || co.trade_name || co.legal_name || "Empresa";

  // Color del PDF: override por producto si existe, si no de la empresa.
  const brandHex =
    (p.datasheet_color_accent && /^#?[0-9a-f]{6}$/i.test(p.datasheet_color_accent)
      ? p.datasheet_color_accent
      : co.pdf_brand_color && /^#?[0-9a-f]{6}$/i.test(co.pdf_brand_color)
        ? co.pdf_brand_color
        : DEFAULT_BRAND);
  const PRIMARY = hexToRgb(brandHex);

  // Categoría
  let categoryName: string | null = null;
  if (p.category_id) {
    const { data: cat } = await admin
      .from("product_categories")
      .select("name")
      .eq("id", p.category_id)
      .maybeSingle();
    categoryName = (cat as { name: string } | null)?.name ?? null;
  }

  // Atributos: solo is_visible=true; ya respetamos así la regla del usuario
  // (toggle apaga atributo → no aparece en PDF; toggle enciende → vuelve).
  let attrRows: AttrValue[] = [];
  {
    const { data: rows } = await admin
      .from("product_attribute_values")
      .select(
        "is_visible, is_featured, value_text, value_number, value_boolean, data_type, display_order, attribute_id, product_attributes ( key, name, unit )",
      )
      .eq("product_id", productId)
      .eq("is_visible", true)
      .order("display_order");
    type Row = {
      is_visible: boolean;
      is_featured: boolean;
      value_text: string | null;
      value_number: number | null;
      value_boolean: boolean | null;
      data_type: string;
      display_order: number;
      product_attributes: { key: string; name: string; unit: string | null } | null;
    };
    attrRows = ((rows ?? []) as Row[])
      .map<AttrValue>((r) => ({
        attribute_key: r.product_attributes?.key ?? "",
        attribute_name: r.product_attributes?.name ?? "",
        unit: r.product_attributes?.unit ?? null,
        value_text: r.value_text,
        value_number: r.value_number,
        value_boolean: r.value_boolean,
        data_type: r.data_type,
        is_visible: r.is_visible,
        is_featured: r.is_featured,
        display_order: r.display_order,
      }))
      .filter((a) => hasValue(a));
  }

  // Filtros que lleva el equipo (mantenimiento recomendado)
  let filterAssignments: FilterAssignment[] = [];
  try {
    const { data: rows } = await admin
      .from("product_filter_assignments")
      .select(
        "stage_position, replacement_period_months, product_filters ( name, filter_type, lifespan_months )",
      )
      .eq("product_id", productId)
      .order("stage_position");
    type Row = {
      stage_position: number | null;
      replacement_period_months: number | null;
      product_filters: { name: string; filter_type: string | null; lifespan_months: number | null } | null;
    };
    filterAssignments = ((rows ?? []) as Row[])
      .filter((r) => r.product_filters)
      .map((r) => ({
        filter_name: r.product_filters?.name ?? "—",
        filter_type: r.product_filters?.filter_type ?? null,
        stage_position: r.stage_position,
        replacement_period_months: r.replacement_period_months,
        lifespan_months: r.product_filters?.lifespan_months ?? null,
      }));
  } catch {
    /* tabla puede no existir en alguna BD; fail-soft */
  }

  // Certificaciones
  let certifications: CertificationRow[] = [];
  try {
    const { data: rows } = await admin
      .from("product_certifications")
      .select(
        "certification_key, certificate_number, valid_until, certifications_catalog ( name_es, category )",
      )
      .eq("product_id", productId)
      .order("display_order");
    type Row = {
      certification_key: string;
      certificate_number: string | null;
      valid_until: string | null;
      certifications_catalog: { name_es: string; category: string } | null;
    };
    certifications = ((rows ?? []) as Row[])
      .filter((r) => r.certifications_catalog)
      .map((r) => ({
        certification_key: r.certification_key,
        name_es: r.certifications_catalog?.name_es ?? r.certification_key,
        category: r.certifications_catalog?.category ?? "other",
        certificate_number: r.certificate_number,
        valid_until: r.valid_until,
      }));
  } catch {
    /* fail-soft */
  }

  // ------------------------------------------------------------------------
  // 2. Crear PDF
  // ------------------------------------------------------------------------
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  function pageBreakIfNeeded(spaceNeeded: number, currentY: number): number {
    if (currentY - spaceNeeded < 70) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      return PAGE_H - MARGIN;
    }
    return currentY;
  }

  // ===== Cabecera =====
  const headerH = 80;
  page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: headerH,
    color: PRIMARY,
  });

  // Logo o nombre empresa a la izquierda
  let logoDrawn = false;
  if (fi.fiscal_logo_url) {
    try {
      const res = await fetch(fi.fiscal_logo_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = fi.fiscal_logo_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const targetH = 42;
      const ratio = img.width / img.height;
      page.drawImage(img, {
        x: MARGIN,
        y: PAGE_H - headerH + 19,
        width: targetH * ratio,
        height: targetH,
      });
      logoDrawn = true;
    } catch {
      /* fail-soft */
    }
  }
  if (!logoDrawn) {
    page.drawText(companyName.toUpperCase(), {
      x: MARGIN,
      y: PAGE_H - 40,
      size: 14,
      font: bold,
      color: COLOR_WHITE,
    });
  }

  // Título FICHA TÉCNICA + SKU a la derecha
  const title = "FICHA TÉCNICA";
  const titleW = bold.widthOfTextAtSize(title, 18);
  page.drawText(title, {
    x: PAGE_W - MARGIN - titleW,
    y: PAGE_H - 40,
    size: 18,
    font: bold,
    color: COLOR_WHITE,
  });
  if (p.internal_reference) {
    const ref = `Ref. ${p.internal_reference}`;
    page.drawText(ref, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(ref, 9),
      y: PAGE_H - 58,
      size: 9,
      font,
      color: lighten(PRIMARY, 0.7),
    });
  }
  // Código de ficha (fecha)
  const today = new Date().toISOString().slice(0, 10);
  const sheetCode = `Edición ${today}`;
  page.drawText(sheetCode, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(sheetCode, 7),
    y: PAGE_H - 70,
    size: 7,
    font,
    color: lighten(PRIMARY, 0.7),
  });

  let y = PAGE_H - headerH - 24;

  // ===== Nombre, marca/modelo, marketing claim, categoría, tags =====
  page.drawText(p.name, { x: MARGIN, y, size: 20, font: bold, color: COLOR_TEXT });
  y -= 22;

  if (p.manufacturer_name || p.manufacturer_model) {
    const mfg = [p.manufacturer_name, p.manufacturer_model].filter(Boolean).join(" · ");
    page.drawText(mfg, { x: MARGIN, y, size: 9, font, color: COLOR_MUTED });
    y -= 12;
  }

  if (p.marketing_claim) {
    const claimLines = wrapText(bold, p.marketing_claim, 11, PAGE_W - 2 * MARGIN).slice(0, 2);
    for (const line of claimLines) {
      page.drawText(line, { x: MARGIN, y, size: 11, font: bold, color: PRIMARY });
      y -= 14;
    }
  }

  // Categoría + tags como chips
  let chipX = MARGIN;
  const chipY = y - 4;
  let chipsDrawn = false;
  if (categoryName) {
    chipX = drawChip(page, bold, chipX, chipY, categoryName.toUpperCase(), PRIMARY, COLOR_WHITE, 8);
    chipsDrawn = true;
  }
  if (p.tags && p.tags.length > 0) {
    const chipBg = lighten(PRIMARY, 0.78);
    for (const t of p.tags.slice(0, 8)) {
      chipX = drawChip(page, font, chipX, chipY, t, chipBg, PRIMARY, 7);
      if (chipX > PAGE_W - MARGIN - 60) break;
      chipsDrawn = true;
    }
  }
  if (chipsDrawn) y -= 18;
  y -= 8;

  // ===== Foto + descripción =====
  const blockY = y;
  const photoW = 200;
  const photoH = 160;
  let photoDrawn = false;
  if (p.main_image_url) {
    try {
      const res = await fetch(p.main_image_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = p.main_image_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const ratio = img.width / img.height;
      let drawW = photoW;
      let drawH = drawW / ratio;
      if (drawH > photoH) {
        drawH = photoH;
        drawW = drawH * ratio;
      }
      page.drawRectangle({
        x: MARGIN,
        y: blockY - photoH,
        width: photoW,
        height: photoH,
        color: COLOR_BG_SOFT,
        borderColor: COLOR_BORDER,
        borderWidth: 1,
      });
      page.drawImage(img, {
        x: MARGIN + (photoW - drawW) / 2,
        y: blockY - photoH + (photoH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
      photoDrawn = true;
    } catch {
      /* fail-soft */
    }
  }

  const descX = photoDrawn ? MARGIN + photoW + 20 : MARGIN;
  const descMaxW = PAGE_W - MARGIN - descX;
  let descY = blockY;
  page.drawText("DESCRIPCIÓN", {
    x: descX,
    y: descY,
    size: 8,
    font: bold,
    color: PRIMARY,
  });
  descY -= 12;
  page.drawLine({
    start: { x: descX, y: descY + 4 },
    end: { x: descX + Math.min(descMaxW, 60), y: descY + 4 },
    thickness: 1.5,
    color: PRIMARY,
  });
  descY -= 6;
  const desc = p.short_description || p.long_description || "Sin descripción disponible.";
  for (const line of wrapText(font, desc, 10, descMaxW).slice(0, 10)) {
    page.drawText(line, { x: descX, y: descY, size: 10, font, color: COLOR_TEXT });
    descY -= 13;
  }

  if (p.country_of_origin) {
    descY -= 6;
    page.drawText(`Origen: ${p.country_of_origin}`, {
      x: descX,
      y: descY,
      size: 8,
      font,
      color: COLOR_MUTED,
    });
    descY -= 12;
  }

  y = (photoDrawn ? blockY - photoH : descY) - 24;

  // ===== ESPECIFICACIONES TÉCNICAS por secciones =====
  const sections: Record<SectionKey, AttrValue[]> = {
    hydraulic: [],
    performance: [],
    consumables: [],
    electric: [],
    physical: [],
    other: [],
  };
  for (const a of attrRows) {
    sections[classifyAttribute(a.attribute_key)].push(a);
  }

  const hasAnySection = SECTION_ORDER.some((s) => sections[s].length > 0);

  if (hasAnySection) {
    y = pageBreakIfNeeded(40, y);
    page.drawText("ESPECIFICACIONES TÉCNICAS", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: PRIMARY,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE_W - MARGIN, y: y - 4 },
      thickness: 0.6,
      color: PRIMARY,
    });
    y -= 18;

    for (const sec of SECTION_ORDER) {
      const items = sections[sec];
      if (items.length === 0) continue;

      y = pageBreakIfNeeded(18 + items.length * 16, y);

      // Subtítulo de sección
      page.drawText(SECTION_LABEL[sec], {
        x: MARGIN,
        y,
        size: 8,
        font: bold,
        color: PRIMARY,
      });
      y -= 12;

      // Filas tipo "etiqueta — valor" en dos columnas
      const innerW = PAGE_W - 2 * MARGIN;
      const colW = innerW / 2;
      let leftY = y;
      let rightY = y;
      let col = 0;
      for (const a of items) {
        const xCol = col === 0 ? MARGIN : MARGIN + colW + 8;
        const startY = col === 0 ? leftY : rightY;
        const rowH = 16;
        page.drawRectangle({
          x: xCol,
          y: startY - rowH + 4,
          width: colW - 8,
          height: rowH,
          color: col === 0 ? COLOR_BG_SOFT : COLOR_WHITE,
          borderColor: COLOR_BORDER,
          borderWidth: 0.4,
        });
        const labelLines = wrapText(font, a.attribute_name, 8, colW * 0.55);
        page.drawText(labelLines[0] ?? a.attribute_name, {
          x: xCol + 6,
          y: startY - 8,
          size: 8,
          font,
          color: COLOR_MUTED,
        });
        const valTxt = valueAsText(a);
        const valW = bold.widthOfTextAtSize(valTxt, 9);
        page.drawText(valTxt, {
          x: xCol + colW - 14 - valW,
          y: startY - 8,
          size: 9,
          font: bold,
          color: COLOR_TEXT,
        });
        if (col === 0) leftY -= rowH;
        else rightY -= rowH;
        col = (col + 1) % 2;
      }
      y = Math.min(leftY, rightY) - 6;
    }
  }

  // ===== DIMENSIONES + ISOMÉTRICO =====
  if (p.dim_width_mm && p.dim_height_mm && p.dim_depth_mm) {
    y = pageBreakIfNeeded(160, y);
    page.drawText("DIMENSIONES", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: PRIMARY,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE_W - MARGIN, y: y - 4 },
      thickness: 0.6,
      color: PRIMARY,
    });
    y -= 24;

    drawIsoBox(
      page,
      bold,
      MARGIN + 110,
      y - 60,
      p.dim_width_mm,
      p.dim_height_mm,
      p.dim_depth_mm,
      PRIMARY,
    );

    const tx = MARGIN + 250;
    let ty = y - 10;
    const dimRows: Array<[string, string]> = [
      ["Ancho", `${p.dim_width_mm} mm`],
      ["Alto", `${p.dim_height_mm} mm`],
      ["Profundo", `${p.dim_depth_mm} mm`],
    ];
    if (p.weight_grams) {
      dimRows.push(["Peso", `${(p.weight_grams / 1000).toFixed(2)} kg`]);
    }
    for (const [k, v] of dimRows) {
      page.drawText(k.toUpperCase(), { x: tx, y: ty, size: 8, font: bold, color: COLOR_MUTED });
      page.drawText(v, { x: tx + 80, y: ty, size: 10, font: bold, color: COLOR_TEXT });
      ty -= 16;
    }

    y -= 140;
  }

  // ===== MANTENIMIENTO RECOMENDADO (filtros + periodicidad) =====
  if (filterAssignments.length > 0) {
    y = pageBreakIfNeeded(40 + filterAssignments.length * 14, y);
    page.drawText("MANTENIMIENTO RECOMENDADO", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: PRIMARY,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE_W - MARGIN, y: y - 4 },
      thickness: 0.6,
      color: PRIMARY,
    });
    y -= 18;

    for (const f of filterAssignments) {
      const stage = f.stage_position != null ? `Etapa ${f.stage_position}` : "—";
      const period = f.replacement_period_months ?? f.lifespan_months;
      const periodTxt = period ? `cada ${period} meses` : "—";
      page.drawText(stage, { x: MARGIN, y, size: 8, font: bold, color: COLOR_MUTED });
      page.drawText(f.filter_name, {
        x: MARGIN + 70,
        y,
        size: 10,
        font,
        color: COLOR_TEXT,
      });
      const periodW = font.widthOfTextAtSize(periodTxt, 9);
      page.drawText(periodTxt, {
        x: PAGE_W - MARGIN - periodW,
        y,
        size: 9,
        font: bold,
        color: PRIMARY,
      });
      y -= 14;
    }
    y -= 8;
  }

  // ===== GARANTÍA =====
  const warranties: Array<[string, number]> = (
    [
      ["General", p.warranty_months_general],
      ["Electrónica", p.warranty_months_electronics],
      ["Carcasa / botella", p.warranty_months_body],
    ] as Array<[string, number | null]>
  ).filter((row): row is [string, number] => row[1] != null && row[1] > 0);
  if (warranties.length > 0) {
    y = pageBreakIfNeeded(40, y);
    page.drawText("GARANTÍA", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: PRIMARY,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE_W - MARGIN, y: y - 4 },
      thickness: 0.6,
      color: PRIMARY,
    });
    y -= 18;
    let wx = MARGIN;
    for (const [label, months] of warranties) {
      const text = `${label}: ${months} meses`;
      const w = font.widthOfTextAtSize(text, 9) + 16;
      page.drawRectangle({
        x: wx,
        y: y - 4,
        width: w,
        height: 18,
        color: lighten(COLOR_SUCCESS, 0.85),
        borderColor: COLOR_SUCCESS,
        borderWidth: 0.4,
      });
      page.drawText(text, { x: wx + 8, y: y + 1, size: 9, font, color: COLOR_SUCCESS });
      wx += w + 6;
      if (wx > PAGE_W - MARGIN - 100) {
        wx = MARGIN;
        y -= 22;
      }
    }
    y -= 26;
  }

  // ===== CERTIFICACIONES =====
  if (certifications.length > 0) {
    y = pageBreakIfNeeded(40, y);
    page.drawText("CERTIFICACIONES Y NORMATIVAS", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: PRIMARY,
    });
    page.drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: PAGE_W - MARGIN, y: y - 4 },
      thickness: 0.6,
      color: PRIMARY,
    });
    y -= 18;

    let cx = MARGIN;
    for (const c of certifications) {
      cx = drawChip(page, bold, cx, y, c.name_es, lighten(PRIMARY, 0.78), PRIMARY, 8);
      if (cx > PAGE_W - MARGIN - 80) {
        cx = MARGIN;
        y -= 18;
      }
    }
    y -= 22;
  }

  // ===== Pie =====
  const footerY = 32;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 22 },
    end: { x: PAGE_W - MARGIN, y: footerY + 22 },
    thickness: 0.5,
    color: COLOR_BORDER,
  });
  const footerL1 = [companyName, fi.fiscal_tax_id ? `CIF ${fi.fiscal_tax_id}` : null]
    .filter(Boolean)
    .join("  ·  ");
  const footerL2 = [
    fi.fiscal_address,
    fi.fiscal_postal_code && fi.fiscal_city
      ? `${fi.fiscal_postal_code} ${fi.fiscal_city}`
      : fi.fiscal_city,
    fi.fiscal_province,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const footerR = [fi.fiscal_phone, fi.fiscal_email].filter(Boolean).join("  ·  ");
  page.drawText(footerL1, { x: MARGIN, y: footerY + 10, size: 8, font: bold, color: COLOR_TEXT });
  if (footerL2) page.drawText(footerL2, { x: MARGIN, y: footerY, size: 7, font, color: COLOR_MUTED });
  if (footerR) {
    page.drawText(footerR, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(footerR, 7),
      y: footerY,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
  }

  return await pdf.save();
}
