/**
 * Catalog PDF v2 — Fase 4 del Plan Productos v2 (2026-06-04).
 *
 * Generador de catálogo profesional configurable. Diferencias con v1:
 *   - Color de cabecera viene de companies.pdf_brand_color.
 *   - El llamador decide:
 *       · Qué productos incluir (selección manual o categoría).
 *       · Qué precios mostrar por tipo (cash particular / cash empresa /
 *         renting 24/36/48/60 / alquiler).
 *       · Si se muestra branding y datos de contacto.
 *       · Título y mensaje de portada.
 *   - Layout: portada + 1 producto por bloque con foto miniatura,
 *     descripción y bloque de precios.
 *
 * El catalog-pdf.ts original queda intacto para no romper la ruta antigua.
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
const DEFAULT_BRAND = "#2563EB";

// =============================================================================
// Tipos
// =============================================================================

export interface CatalogPricingVisibility {
  cash_individual?: boolean;
  cash_business?: boolean;
  renting_24?: boolean;
  renting_36?: boolean;
  renting_48?: boolean;
  renting_60?: boolean;
  rental?: boolean;
}

export interface GenerateCatalogInput {
  companyId: string;
  /** Productos a incluir, en orden de aparición. */
  productIds: string[];
  /** Qué precios mostrar por producto. */
  pricingVisibility: CatalogPricingVisibility;
  /** Título visible en portada. */
  title?: string;
  /** Mensaje de bienvenida bajo el título. */
  intro?: string;
  /** Si false, sin logo en cabecera. */
  showCompanyBranding?: boolean;
  /** Si false, sin email/teléfono en pie. */
  showCompanyContact?: boolean;
}

interface ProductRow {
  id: string;
  name: string;
  short_description: string | null;
  marketing_claim: string | null;
  manufacturer_name: string | null;
  manufacturer_model: string | null;
  internal_reference: string | null;
  category_id: string | null;
  main_image_url: string | null;
  tags: string[] | null;
}

interface PricingPlanRow {
  product_id: string;
  plan_type: "cash" | "renting" | "rental";
  duration_months: number | null;
  total_price_cents: number;
  monthly_price_cents: number | null;
  total_price_individual_cents: number | null;
  total_price_business_cents: number | null;
  monthly_price_individual_cents: number | null;
  monthly_price_business_cents: number | null;
}

// =============================================================================
// Helpers
// =============================================================================

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return rgb(0.16, 0.39, 1);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

function lighten(c: RGB, amount: number): RGB {
  return rgb(
    Math.min(1, c.red + amount),
    Math.min(1, c.green + amount),
    Math.min(1, c.blue + amount),
  );
}

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

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
// Construcción de filas de precio según visibility
// =============================================================================

interface PriceLine {
  label: string;
  value: string;
}

function buildPriceLines(
  plans: PricingPlanRow[],
  vis: CatalogPricingVisibility,
): PriceLine[] {
  const out: PriceLine[] = [];
  const cash = plans.find((p) => p.plan_type === "cash");
  if (cash) {
    if (vis.cash_individual) {
      const v =
        cash.total_price_individual_cents ?? cash.total_price_cents;
      out.push({ label: "Particular (IVA inc.)", value: eur(v) });
    }
    if (vis.cash_business) {
      const v =
        cash.total_price_business_cents ?? cash.total_price_cents;
      out.push({ label: "Empresa (base)", value: eur(v) });
    }
  }
  const rentingByMonths = new Map<number, PricingPlanRow>();
  for (const p of plans) {
    if (p.plan_type === "renting" && p.duration_months) {
      rentingByMonths.set(p.duration_months, p);
    }
  }
  const rentingChecks: Array<[number, keyof CatalogPricingVisibility]> = [
    [24, "renting_24"],
    [36, "renting_36"],
    [48, "renting_48"],
    [60, "renting_60"],
  ];
  for (const [months, flag] of rentingChecks) {
    if (!vis[flag]) continue;
    const plan = rentingByMonths.get(months);
    if (!plan) continue;
    const monthly =
      plan.monthly_price_individual_cents ??
      plan.monthly_price_cents ??
      (plan.total_price_cents && plan.duration_months
        ? Math.round(plan.total_price_cents / plan.duration_months)
        : null);
    out.push({
      label: `Renting ${months}m`,
      value: `${eur(monthly)} /mes`,
    });
  }
  if (vis.rental) {
    const rental = plans.find((p) => p.plan_type === "rental");
    if (rental) {
      const monthly =
        rental.monthly_price_individual_cents ??
        rental.monthly_price_cents ??
        rental.total_price_cents;
      out.push({ label: "Alquiler", value: `${eur(monthly)} /mes` });
    }
  }
  return out;
}

// =============================================================================
// Entry point
// =============================================================================

export async function generateProductCatalogV2(
  input: GenerateCatalogInput,
): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ------------------------------------------------------------------
  // 1. Cargar empresa
  // ------------------------------------------------------------------
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, pdf_brand_color")
    .eq("id", input.companyId)
    .maybeSingle();
  const co = (company ?? {}) as {
    legal_name: string | null;
    trade_name: string | null;
    pdf_brand_color: string | null;
  };

  const { data: fiscalRow } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_email, fiscal_phone, fiscal_city, fiscal_province, fiscal_logo_url",
    )
    .eq("company_id", input.companyId)
    .maybeSingle();
  const fi = (fiscalRow ?? {}) as {
    fiscal_legal_name: string | null;
    fiscal_tax_id: string | null;
    fiscal_email: string | null;
    fiscal_phone: string | null;
    fiscal_city: string | null;
    fiscal_province: string | null;
    fiscal_logo_url: string | null;
  };

  const brandHex =
    co.pdf_brand_color && /^#?[0-9a-f]{6}$/i.test(co.pdf_brand_color)
      ? co.pdf_brand_color
      : DEFAULT_BRAND;
  const PRIMARY = hexToRgb(brandHex);
  const companyName = fi.fiscal_legal_name || co.trade_name || co.legal_name || "Empresa";
  const showBranding = input.showCompanyBranding !== false;
  const showContact = input.showCompanyContact !== false;

  // ------------------------------------------------------------------
  // 2. Cargar productos en el orden pedido
  // ------------------------------------------------------------------
  let products: ProductRow[] = [];
  if (input.productIds.length > 0) {
    const colsFull =
      "id, name, short_description, marketing_claim, manufacturer_name, manufacturer_model, internal_reference, category_id, main_image_url, tags";
    const colsBasic =
      "id, name, short_description, internal_reference, category_id, main_image_url";
    const r1 = await admin
      .from("products")
      .select(colsFull)
      .in("id", input.productIds)
      .is("deleted_at", null);
    if (r1.error && /column .* does not exist|schema cache/i.test(r1.error.message ?? "")) {
      const r2 = await admin
        .from("products")
        .select(colsBasic)
        .in("id", input.productIds)
        .is("deleted_at", null);
      products = ((r2.data ?? []) as Array<Record<string, unknown>>).map(
        (p) => ({
          ...(p as unknown as ProductRow),
          marketing_claim: null,
          manufacturer_name: null,
          manufacturer_model: null,
          tags: null,
        }),
      );
    } else {
      products = (r1.data ?? []) as ProductRow[];
    }
  }

  // Reordenar según `input.productIds`
  const orderMap = new Map(input.productIds.map((id, i) => [id, i]));
  products.sort(
    (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0),
  );

  // Planes de precio
  let plansByProduct = new Map<string, PricingPlanRow[]>();
  if (products.length > 0) {
    const colsFull =
      "product_id, plan_type, duration_months, total_price_cents, monthly_price_cents, total_price_individual_cents, total_price_business_cents, monthly_price_individual_cents, monthly_price_business_cents, is_active";
    const colsBasic =
      "product_id, plan_type, duration_months, total_price_cents, monthly_price_cents, is_active";
    const r1 = await admin
      .from("product_pricing_plans")
      .select(colsFull)
      .in("product_id", products.map((p) => p.id))
      .eq("is_active", true);
    let plans: PricingPlanRow[] = [];
    if (r1.error && /column .* does not exist|schema cache/i.test(r1.error.message ?? "")) {
      const r2 = await admin
        .from("product_pricing_plans")
        .select(colsBasic)
        .in(
          "product_id",
          products.map((p) => p.id),
        )
        .eq("is_active", true);
      plans = ((r2.data ?? []) as Array<Record<string, unknown>>).map(
        (p) => ({
          ...(p as unknown as PricingPlanRow),
          total_price_individual_cents: null,
          total_price_business_cents: null,
          monthly_price_individual_cents: null,
          monthly_price_business_cents: null,
        }),
      );
    } else {
      plans = (r1.data ?? []) as PricingPlanRow[];
    }
    plansByProduct = new Map();
    for (const p of plans) {
      if (!plansByProduct.has(p.product_id)) plansByProduct.set(p.product_id, []);
      plansByProduct.get(p.product_id)!.push(p);
    }
  }

  // Atributos destacados (is_featured)
  const featuredByProduct = new Map<string, Array<{ name: string; value: string }>>();
  if (products.length > 0) {
    const { data: rawAttrs } = await admin
      .from("product_attribute_values")
      .select(
        "product_id, is_featured, is_visible, value_text, value_number, value_boolean, data_type, display_order, product_attributes ( name, unit )",
      )
      .in(
        "product_id",
        products.map((p) => p.id),
      )
      .eq("is_visible", true)
      .eq("is_featured", true)
      .order("display_order");
    type Row = {
      product_id: string;
      is_featured: boolean;
      is_visible: boolean;
      value_text: string | null;
      value_number: number | null;
      value_boolean: boolean | null;
      data_type: string;
      product_attributes: { name: string; unit: string | null } | null;
    };
    for (const r of ((rawAttrs ?? []) as Row[])) {
      const unit = r.product_attributes?.unit ?? null;
      let value: string | null = null;
      if (r.data_type === "boolean") value = r.value_boolean ? "Sí" : "No";
      else if (r.data_type === "number" || r.data_type === "dimension") {
        if (r.value_number != null) {
          value = `${new Intl.NumberFormat("es-ES").format(r.value_number)}${unit ? " " + unit : ""}`;
        }
      } else {
        value = r.value_text;
      }
      if (value && r.product_attributes?.name) {
        if (!featuredByProduct.has(r.product_id))
          featuredByProduct.set(r.product_id, []);
        featuredByProduct
          .get(r.product_id)!
          .push({ name: r.product_attributes.name, value });
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Construir PDF
  // ------------------------------------------------------------------
  const pdf = await PDFDocument.create();
  const font = withSanitizer(await pdf.embedFont(StandardFonts.Helvetica));
  const bold = withSanitizer(await pdf.embedFont(StandardFonts.HelveticaBold));
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let pageNum = 1;

  function drawHeader(p: PDFPage, num: number) {
    p.drawRectangle({
      x: 0,
      y: PAGE_H - 50,
      width: PAGE_W,
      height: 50,
      color: PRIMARY,
    });
    if (showBranding) {
      p.drawText(companyName.toUpperCase(), {
        x: MARGIN,
        y: PAGE_H - 30,
        size: 12,
        font: bold,
        color: COLOR_WHITE,
      });
    }
    const numTxt = `Pág. ${num}`;
    p.drawText(numTxt, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(numTxt, 9),
      y: PAGE_H - 30,
      size: 9,
      font,
      color: lighten(PRIMARY, 0.7),
    });
  }

  function drawFooter(p: PDFPage) {
    p.drawLine({
      start: { x: MARGIN, y: 30 },
      end: { x: PAGE_W - MARGIN, y: 30 },
      thickness: 0.5,
      color: COLOR_BORDER,
    });
    const parts = [companyName];
    if (showContact) {
      if (fi.fiscal_phone) parts.push(fi.fiscal_phone);
      if (fi.fiscal_email) parts.push(fi.fiscal_email);
      if (fi.fiscal_city) parts.push(fi.fiscal_city);
    }
    p.drawText(parts.join("  ·  "), {
      x: MARGIN,
      y: 18,
      size: 7,
      font,
      color: COLOR_MUTED,
    });
  }

  // ===== PORTADA =====
  drawHeader(page, pageNum);

  let y = PAGE_H - 100;
  if (showBranding && fi.fiscal_logo_url) {
    try {
      const res = await fetch(fi.fiscal_logo_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = fi.fiscal_logo_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const targetH = 70;
      const ratio = img.width / img.height;
      page.drawImage(img, {
        x: PAGE_W / 2 - (targetH * ratio) / 2,
        y: y - targetH,
        width: targetH * ratio,
        height: targetH,
      });
      y -= targetH + 30;
    } catch {
      y -= 10;
    }
  }

  const titleText = input.title?.trim() || "Catálogo de productos";
  const titleW = bold.widthOfTextAtSize(titleText, 30);
  page.drawText(titleText, {
    x: PAGE_W / 2 - titleW / 2,
    y,
    size: 30,
    font: bold,
    color: COLOR_TEXT,
  });
  y -= 30;

  const dateText = new Date().toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const dateW = font.widthOfTextAtSize(dateText, 11);
  page.drawText(dateText, {
    x: PAGE_W / 2 - dateW / 2,
    y,
    size: 11,
    font,
    color: COLOR_MUTED,
  });
  y -= 40;

  if (input.intro?.trim()) {
    const lines = wrapText(font, input.intro.trim(), 11, PAGE_W - 2 * MARGIN);
    for (const line of lines.slice(0, 6)) {
      page.drawText(line, {
        x: MARGIN,
        y,
        size: 11,
        font,
        color: COLOR_TEXT,
      });
      y -= 16;
    }
  }

  page.drawText(`${products.length} ${products.length === 1 ? "producto" : "productos"}`, {
    x: MARGIN,
    y: 60,
    size: 10,
    font: bold,
    color: PRIMARY,
  });

  drawFooter(page);

  // ===== PRODUCTOS =====
  function newPage() {
    drawFooter(page);
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNum += 1;
    drawHeader(page, pageNum);
  }

  page = pdf.addPage([PAGE_W, PAGE_H]);
  pageNum += 1;
  drawHeader(page, pageNum);
  y = PAGE_H - 80;

  for (const p of products) {
    // Card del producto. ~200 pts de alto.
    const cardH = 200;
    if (y - cardH < 60) {
      newPage();
      y = PAGE_H - 80;
    }

    // Marco
    page.drawRectangle({
      x: MARGIN,
      y: y - cardH,
      width: PAGE_W - 2 * MARGIN,
      height: cardH,
      color: COLOR_BG_SOFT,
      borderColor: COLOR_BORDER,
      borderWidth: 0.5,
    });

    // Foto izquierda
    const photoBox = 140;
    if (p.main_image_url) {
      try {
        const res = await fetch(p.main_image_url);
        const buf = new Uint8Array(await res.arrayBuffer());
        const img = p.main_image_url.toLowerCase().includes(".png")
          ? await pdf.embedPng(buf)
          : await pdf.embedJpg(buf);
        const ratio = img.width / img.height;
        let drawW = photoBox;
        let drawH = drawW / ratio;
        if (drawH > photoBox) {
          drawH = photoBox;
          drawW = drawH * ratio;
        }
        page.drawImage(img, {
          x: MARGIN + 15 + (photoBox - drawW) / 2,
          y: y - cardH + (cardH - photoBox) / 2 + (photoBox - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      } catch {
        /* fail-soft */
      }
    }

    // Nombre + claim + descripción a la derecha
    const tx = MARGIN + photoBox + 30;
    const tw = PAGE_W - tx - MARGIN - 10;
    let ty = y - 20;
    // Nombre
    const nameLines = wrapText(bold, p.name, 14, tw).slice(0, 2);
    for (const line of nameLines) {
      page.drawText(line, { x: tx, y: ty, size: 14, font: bold, color: COLOR_TEXT });
      ty -= 16;
    }
    if (p.manufacturer_name || p.manufacturer_model) {
      const mfg = [p.manufacturer_name, p.manufacturer_model]
        .filter(Boolean)
        .join(" · ");
      page.drawText(mfg, { x: tx, y: ty, size: 8, font, color: COLOR_MUTED });
      ty -= 12;
    }
    if (p.marketing_claim) {
      const claim = wrapText(bold, p.marketing_claim, 9, tw).slice(0, 2);
      for (const line of claim) {
        page.drawText(line, { x: tx, y: ty, size: 9, font: bold, color: PRIMARY });
        ty -= 11;
      }
    }
    if (p.short_description) {
      const lines = wrapText(font, p.short_description, 9, tw).slice(0, 3);
      for (const line of lines) {
        page.drawText(line, { x: tx, y: ty, size: 9, font, color: COLOR_TEXT });
        ty -= 11;
      }
    }

    // Atributos destacados (máx 3)
    const featured = featuredByProduct.get(p.id) ?? [];
    if (featured.length > 0) {
      ty -= 4;
      for (const f of featured.slice(0, 3)) {
        const text = `· ${f.name}: ${f.value}`;
        const truncated = text.length > 70 ? text.slice(0, 67) + "..." : text;
        page.drawText(truncated, {
          x: tx,
          y: ty,
          size: 8,
          font,
          color: COLOR_MUTED,
        });
        ty -= 10;
      }
    }

    // Precios — abajo del card
    const priceLines = buildPriceLines(plansByProduct.get(p.id) ?? [], input.pricingVisibility);
    if (priceLines.length > 0) {
      let py = y - cardH + 28;
      const pxStart = tx;
      const totalLen = priceLines
        .map((pl) => bold.widthOfTextAtSize(`${pl.label}: ${pl.value}`, 9))
        .reduce((a, b) => a + b + 16, 0);
      let px = pxStart;
      const wrapLines = totalLen > tw;
      for (const pl of priceLines) {
        const txt = `${pl.label}: ${pl.value}`;
        const w = bold.widthOfTextAtSize(txt, 9);
        if (wrapLines && px + w > tx + tw) {
          px = pxStart;
          py -= 12;
        }
        page.drawRectangle({
          x: px - 4,
          y: py - 3,
          width: w + 8,
          height: 14,
          color: lighten(PRIMARY, 0.78),
        });
        page.drawText(txt, {
          x: px,
          y: py + 1,
          size: 9,
          font: bold,
          color: PRIMARY,
        });
        px += w + 12;
      }
    } else if (Object.values(input.pricingVisibility).some(Boolean)) {
      page.drawText("Precio bajo consulta", {
        x: tx,
        y: y - cardH + 28,
        size: 9,
        font,
        color: COLOR_MUTED,
      });
    }

    y -= cardH + 16;
  }

  drawFooter(page);
  return await pdf.save();
}
