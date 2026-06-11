import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createAdminClient } from "@/shared/lib/supabase/admin";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

const PRIMARY = rgb(0.16, 0.39, 1);
const TEXT = rgb(0.1, 0.13, 0.2);
const MUTED = rgb(0.45, 0.5, 0.58);
const BORDER = rgb(0.9, 0.92, 0.96);
const BG_HEADER = rgb(0.13, 0.27, 0.55);
const WHITE = rgb(1, 1, 1);

interface ProductCatRow {
  id: string;
  name: string;
  short_description: string | null;
  internal_reference: string | null;
  kind: string;
  cash_price_cents: number | null;
  category_name: string | null;
}

interface FiscalInfo {
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_city: string | null;
}

function eur(c: number | null): string {
  if (c == null) return "Consultar";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    c / 100,
  );
}

function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawHeader(
  page: PDFPage,
  fiscal: FiscalInfo,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  pageNum: number,
) {
  // Banda azul superior
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 60,
    width: PAGE_W,
    height: 60,
    color: BG_HEADER,
  });
  page.drawText(fiscal.fiscal_legal_name ?? "Catálogo de productos", {
    x: MARGIN,
    y: PAGE_H - 35,
    size: 16,
    font: fontBold,
    color: WHITE,
  });
  if (fiscal.fiscal_tax_id) {
    page.drawText(
      `${fiscal.fiscal_tax_id}${fiscal.fiscal_city ? ` · ${fiscal.fiscal_city}` : ""}`,
      {
        x: MARGIN,
        y: PAGE_H - 52,
        size: 9,
        font: fontRegular,
        color: WHITE,
      },
    );
  }
  page.drawText(`Pág. ${pageNum}`, {
    x: PAGE_W - MARGIN - 40,
    y: PAGE_H - 35,
    size: 10,
    font: fontRegular,
    color: WHITE,
  });
}

function drawFooter(page: PDFPage, fiscal: FiscalInfo, font: PDFFont) {
  const parts = [
    fiscal.fiscal_legal_name,
    fiscal.fiscal_email,
    fiscal.fiscal_phone,
  ].filter(Boolean);
  if (parts.length === 0) return;
  page.drawText(parts.join("  ·  "), {
    x: MARGIN,
    y: 20,
    size: 8,
    font,
    color: MUTED,
  });
}

/**
 * Genera un PDF público con todos los productos activos visibles del
 * catálogo, agrupados por categoría. Para enviar al cliente como
 * folleto promocional.
 *
 * NO incluye coste (cost_cents) ni datos sensibles — solo lo que puede
 * ver un cliente final.
 */
export async function generateProductCatalog(companyId: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Datos fiscales empresa
  const { data: fiscalRow } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_email, fiscal_phone, fiscal_city",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  const fiscal: FiscalInfo = (fiscalRow as FiscalInfo) ?? {
    fiscal_legal_name: null,
    fiscal_tax_id: null,
    fiscal_email: null,
    fiscal_phone: null,
    fiscal_city: null,
  };

  // Productos activos en catálogo
  const { data: prods } = await admin
    .from("products")
    .select(
      // products NO tiene cash_price_cents (el precio vive en product_pricing_plans).
      "id, name, short_description, internal_reference, kind, category_id",
    )
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("category_id")
    .order("name");
  const products = ((prods ?? []) as Array<
    Omit<ProductCatRow, "category_name" | "cash_price_cents"> & { category_id: string | null }
  >);

  // Precio cash desde product_pricing_plans (plan_type='cash').
  const cashPriceById = new Map<string, number | null>();
  if (products.length > 0) {
    const { data: cashPlans } = await admin
      .from("product_pricing_plans")
      .select("product_id, total_price_individual_cents, total_price_cents")
      .eq("company_id", companyId)
      .eq("plan_type", "cash")
      .in(
        "product_id",
        products.map((p) => p.id),
      );
    for (const pl of ((cashPlans ?? []) as Array<{
      product_id: string;
      total_price_individual_cents: number | null;
      total_price_cents: number | null;
    }>)) {
      if (!cashPriceById.has(pl.product_id)) {
        cashPriceById.set(
          pl.product_id,
          pl.total_price_individual_cents ?? pl.total_price_cents ?? null,
        );
      }
    }
  }
  if (products.length === 0) {
    // PDF con mensaje
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    drawHeader(page, fiscal, fontBold, fontRegular, 1);
    page.drawText("Sin productos en el catálogo todavía.", {
      x: MARGIN,
      y: PAGE_H - 120,
      size: 12,
      font: fontRegular,
      color: TEXT,
    });
    drawFooter(page, fiscal, fontRegular);
    return await pdf.save();
  }

  // Resolver nombres de categorías
  const catIds = Array.from(
    new Set(products.map((p) => p.category_id).filter((v): v is string => !!v)),
  );
  let catMap = new Map<string, string>();
  if (catIds.length > 0) {
    const { data: cats } = await admin
      .from("product_categories")
      .select("id, name")
      .in("id", catIds);
    catMap = new Map(
      ((cats ?? []) as Array<{ id: string; name: string }>).map((c) => [
        c.id,
        c.name,
      ]),
    );
  }

  const enriched: ProductCatRow[] = products.map((p) => ({
    ...p,
    cash_price_cents: cashPriceById.get(p.id) ?? null,
    category_name: p.category_id ? catMap.get(p.category_id) ?? "Sin categoría" : "Sin categoría",
  }));

  // Agrupar por categoría
  const byCategory = new Map<string, ProductCatRow[]>();
  for (const p of enriched) {
    const c = p.category_name ?? "Sin categoría";
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(p);
  }
  const sortedCategories = Array.from(byCategory.keys()).sort();

  // Generar PDF
  const pdf = await PDFDocument.create();
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let pageNum = 1;
  drawHeader(page, fiscal, fontBold, fontRegular, pageNum);

  let y = PAGE_H - 100;

  // Título
  page.drawText("Catálogo de productos", {
    x: MARGIN,
    y,
    size: 22,
    font: fontBold,
    color: TEXT,
  });
  y -= 20;
  page.drawText(
    `Generado ${new Date().toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`,
    {
      x: MARGIN,
      y,
      size: 9,
      font: fontRegular,
      color: MUTED,
    },
  );
  y -= 30;

  for (const cat of sortedCategories) {
    if (y < 100) {
      drawFooter(page, fiscal, fontRegular);
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pageNum += 1;
      drawHeader(page, fiscal, fontBold, fontRegular, pageNum);
      y = PAGE_H - 100;
    }
    // Cabecera categoría
    page.drawRectangle({
      x: MARGIN,
      y: y - 4,
      width: PAGE_W - 2 * MARGIN,
      height: 22,
      color: PRIMARY,
    });
    page.drawText(cat, {
      x: MARGIN + 8,
      y: y + 4,
      size: 12,
      font: fontBold,
      color: WHITE,
    });
    y -= 32;

    for (const p of byCategory.get(cat)!) {
      // Necesita ~55 pts por producto (2-3 líneas de descripción).
      if (y < 80) {
        drawFooter(page, fiscal, fontRegular);
        page = pdf.addPage([PAGE_W, PAGE_H]);
        pageNum += 1;
        drawHeader(page, fiscal, fontBold, fontRegular, pageNum);
        y = PAGE_H - 100;
      }
      // Línea producto: nombre + precio derecha
      page.drawText(p.name, {
        x: MARGIN + 8,
        y,
        size: 11,
        font: fontBold,
        color: TEXT,
      });
      const priceText = eur(p.cash_price_cents);
      const priceWidth = fontBold.widthOfTextAtSize(priceText, 11);
      page.drawText(priceText, {
        x: PAGE_W - MARGIN - 8 - priceWidth,
        y,
        size: 11,
        font: fontBold,
        color: PRIMARY,
      });
      y -= 14;
      if (p.internal_reference) {
        page.drawText(`Ref: ${p.internal_reference}`, {
          x: MARGIN + 8,
          y,
          size: 8,
          font: fontRegular,
          color: MUTED,
        });
        y -= 10;
      }
      if (p.short_description) {
        const lines = wrapText(p.short_description, 90).slice(0, 2);
        for (const line of lines) {
          page.drawText(line, {
            x: MARGIN + 8,
            y,
            size: 9,
            font: fontRegular,
            color: TEXT,
          });
          y -= 11;
        }
      }
      // Separador
      page.drawLine({
        start: { x: MARGIN + 8, y: y - 2 },
        end: { x: PAGE_W - MARGIN - 8, y: y - 2 },
        thickness: 0.5,
        color: BORDER,
      });
      y -= 12;
    }
    y -= 10;
  }

  drawFooter(page, fiscal, fontRegular);
  return await pdf.save();
}
