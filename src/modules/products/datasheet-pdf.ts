import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { withSanitizer } from "@/shared/lib/pdf/dashstack";
import { createAdminClient } from "@/shared/lib/supabase/admin";

interface ProductRow {
  id: string;
  name: string;
  short_description: string | null;
  long_description: string | null;
  internal_reference: string | null;
  supplier_reference: string | null;
  dim_width_mm: number | null;
  dim_height_mm: number | null;
  dim_depth_mm: number | null;
  weight_grams: number | null;
  main_image_url: string | null;
  category_id: string | null;
}

interface AttrValue {
  attribute_name: string;
  unit: string | null;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  data_type: string;
  is_featured: boolean;
}

interface FiscalInfo {
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_logo_url: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

const PRIMARY = rgb(0.16, 0.39, 1);
const TEXT = rgb(0.1, 0.13, 0.2);
const MUTED = rgb(0.45, 0.5, 0.58);
const BORDER = rgb(0.9, 0.92, 0.96);
const BG_SOFT = rgb(0.96, 0.97, 0.99);
const BG_HEADER = rgb(0.13, 0.27, 0.55);
const WHITE = rgb(1, 1, 1);

function valueAsText(v: AttrValue): string {
  if (v.data_type === "boolean") return v.value_boolean ? "Sí" : "No";
  if (v.data_type === "number" || v.data_type === "dimension") {
    if (v.value_number == null) return "—";
    const n = new Intl.NumberFormat("es-ES").format(v.value_number);
    return `${n}${v.unit ? " " + v.unit : ""}`;
  }
  return v.value_text ?? "—";
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

/** Caja 3D isométrica con cotas tipo plano CAD. */
function drawIsoBox(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  centerX: number,
  centerY: number,
  widthMm: number,
  heightMm: number,
  depthMm: number,
) {
  const maxMm = Math.max(widthMm, heightMm, depthMm) || 100;
  const scale = 130 / maxMm;
  const w = widthMm * scale;
  const h = heightMm * scale;
  const d = depthMm * scale;
  const dx = d * Math.cos(Math.PI / 6);
  const dy = d * Math.sin(Math.PI / 6);

  const fillFront = rgb(0.93, 0.95, 1);
  const fillTop = rgb(0.78, 0.86, 1);
  const fillSide = rgb(0.62, 0.74, 0.96);
  const edge = rgb(0.16, 0.27, 0.45);

  const x = centerX - (w + dx) / 2;
  const y = centerY - (h + dy) / 2;

  const A = { x, y };
  const B = { x: x + w, y };
  const C = { x: x + w + dx, y: y + dy };
  const E = { x: A.x, y: A.y + h };
  const F = { x: B.x, y: B.y + h };
  const G = { x: C.x, y: C.y + h };
  const H = { x: x + dx, y: y + dy + h };

  // Cara frontal
  page.drawRectangle({
    x: A.x,
    y: A.y,
    width: w,
    height: h,
    color: fillFront,
    borderColor: edge,
    borderWidth: 1.2,
  });
  // Cara superior
  page.drawSvgPath(
    `M ${E.x} ${PAGE_H - E.y} L ${F.x} ${PAGE_H - F.y} L ${G.x} ${PAGE_H - G.y} L ${H.x} ${PAGE_H - H.y} Z`,
    { color: fillTop, borderColor: edge, borderWidth: 1 },
  );
  // Cara lateral derecha
  page.drawSvgPath(
    `M ${B.x} ${PAGE_H - B.y} L ${F.x} ${PAGE_H - F.y} L ${G.x} ${PAGE_H - G.y} L ${C.x} ${PAGE_H - C.y} Z`,
    { color: fillSide, borderColor: edge, borderWidth: 1 },
  );

  // Cotas
  const cotaColor = rgb(0.5, 0.55, 0.62);
  const yWidth = A.y - 18;
  page.drawLine({ start: { x: A.x, y: yWidth }, end: { x: B.x, y: yWidth }, thickness: 0.6, color: cotaColor });
  page.drawLine({ start: { x: A.x, y: A.y - 4 }, end: { x: A.x, y: yWidth - 2 }, thickness: 0.5, color: cotaColor });
  page.drawLine({ start: { x: B.x, y: B.y - 4 }, end: { x: B.x, y: yWidth - 2 }, thickness: 0.5, color: cotaColor });
  const widthLabel = `${widthMm} mm`;
  const widthLabelW = bold.widthOfTextAtSize(widthLabel, 8);
  page.drawRectangle({
    x: A.x + w / 2 - widthLabelW / 2 - 4,
    y: yWidth - 5,
    width: widthLabelW + 8,
    height: 11,
    color: WHITE,
  });
  page.drawText(widthLabel, {
    x: A.x + w / 2 - widthLabelW / 2,
    y: yWidth - 3,
    size: 8,
    font: bold,
    color: TEXT,
  });

  const xH = A.x - 22;
  page.drawLine({ start: { x: xH, y: A.y }, end: { x: xH, y: E.y }, thickness: 0.6, color: cotaColor });
  page.drawLine({ start: { x: A.x - 4, y: A.y }, end: { x: xH - 2, y: A.y }, thickness: 0.5, color: cotaColor });
  page.drawLine({ start: { x: A.x - 4, y: E.y }, end: { x: xH - 2, y: E.y }, thickness: 0.5, color: cotaColor });
  const heightLabel = `${heightMm} mm`;
  const heightLabelW = bold.widthOfTextAtSize(heightLabel, 8);
  const hLabelY = A.y + h / 2;
  page.drawRectangle({
    x: xH - heightLabelW - 6,
    y: hLabelY - 5,
    width: heightLabelW + 8,
    height: 11,
    color: WHITE,
  });
  page.drawText(heightLabel, {
    x: xH - heightLabelW - 2,
    y: hLabelY - 3,
    size: 8,
    font: bold,
    color: TEXT,
  });

  const depthLabel = `${depthMm} mm`;
  page.drawText(depthLabel, {
    x: G.x + 6,
    y: G.y - h / 2 - 3,
    size: 8,
    font: bold,
    color: TEXT,
  });
}

export async function generateProductDatasheet(productId: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prod } = await admin
    .from("products")
    .select(
      "id, name, short_description, long_description, internal_reference, supplier_reference, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, main_image_url, category_id, company_id",
    )
    .eq("id", productId)
    .maybeSingle();
  if (!prod) throw new Error("Producto no encontrado");
  const p = prod as ProductRow & { company_id: string };

  const { data: fiscal } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_email, fiscal_phone, fiscal_logo_url, fiscal_city, fiscal_province",
    )
    .eq("company_id", p.company_id)
    .maybeSingle();
  const fi = (fiscal ?? {}) as FiscalInfo;
  const { data: companyRow } = await admin
    .from("companies")
    .select("legal_name, trade_name")
    .eq("id", p.company_id)
    .maybeSingle();
  const co = (companyRow ?? {}) as { legal_name: string | null; trade_name: string | null };
  const companyName = fi.fiscal_legal_name || co.trade_name || co.legal_name || "Empresa";

  let categoryName: string | null = null;
  if (p.category_id) {
    const { data: cat } = await admin
      .from("product_categories")
      .select("name")
      .eq("id", p.category_id)
      .maybeSingle();
    categoryName = (cat as { name: string } | null)?.name ?? null;
  }

  const { data: attrs } = await admin
    .from("product_attribute_values")
    .select(
      "is_featured, value_text, value_number, value_boolean, data_type, attribute_id, product_attributes ( name, unit )",
    )
    .eq("product_id", productId)
    .eq("is_featured", true)
    .order("display_order");
  type Row = {
    is_featured: boolean;
    value_text: string | null;
    value_number: number | null;
    value_boolean: boolean | null;
    data_type: string;
    product_attributes: { name: string; unit: string | null } | null;
  };
  const featured = ((attrs ?? []) as Row[]).map<AttrValue>((r) => ({
    attribute_name: r.product_attributes?.name ?? "",
    unit: r.product_attributes?.unit ?? null,
    value_text: r.value_text,
    value_number: r.value_number,
    value_boolean: r.value_boolean,
    data_type: r.data_type,
    is_featured: r.is_featured,
  }));

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = withSanitizer(await pdf.embedFont(StandardFonts.Helvetica));
  const bold = withSanitizer(await pdf.embedFont(StandardFonts.HelveticaBold));

  // ===== Cabecera =====
  const headerH = 90;
  page.drawRectangle({
    x: 0,
    y: PAGE_H - headerH,
    width: PAGE_W,
    height: headerH,
    color: BG_HEADER,
  });
  if (fi.fiscal_logo_url) {
    try {
      const res = await fetch(fi.fiscal_logo_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = fi.fiscal_logo_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const targetH = 50;
      const ratio = img.width / img.height;
      page.drawImage(img, {
        x: MARGIN,
        y: PAGE_H - headerH + 20,
        width: targetH * ratio,
        height: targetH,
      });
    } catch {
      /* fail-soft */
    }
  } else {
    page.drawText(companyName.toUpperCase(), {
      x: MARGIN,
      y: PAGE_H - 50,
      size: 16,
      font: bold,
      color: WHITE,
    });
    if (fi.fiscal_city) {
      page.drawText(`${fi.fiscal_city}${fi.fiscal_province ? ", " + fi.fiscal_province : ""}`, {
        x: MARGIN,
        y: PAGE_H - 68,
        size: 9,
        font,
        color: rgb(0.7, 0.78, 0.92),
      });
    }
  }
  const title = "FICHA TÉCNICA";
  page.drawText(title, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(title, 18),
    y: PAGE_H - 50,
    size: 18,
    font: bold,
    color: WHITE,
  });
  if (p.internal_reference) {
    const refTxt = `Ref. ${p.internal_reference}`;
    page.drawText(refTxt, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(refTxt, 10),
      y: PAGE_H - 70,
      size: 10,
      font,
      color: rgb(0.78, 0.86, 1),
    });
  }

  let y = PAGE_H - headerH - 30;

  // ===== Nombre + categoría =====
  page.drawText(p.name, { x: MARGIN, y, size: 22, font: bold, color: TEXT });
  y -= 24;
  if (categoryName) {
    const tagW = bold.widthOfTextAtSize(categoryName.toUpperCase(), 8) + 14;
    page.drawRectangle({
      x: MARGIN,
      y: y - 2,
      width: tagW,
      height: 14,
      color: PRIMARY,
    });
    page.drawText(categoryName.toUpperCase(), {
      x: MARGIN + 7,
      y: y + 1,
      size: 8,
      font: bold,
      color: WHITE,
    });
    y -= 20;
  }
  y -= 10;

  // ===== Foto + Descripción lado a lado =====
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
        color: BG_SOFT,
        borderColor: BORDER,
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

  const descX = photoDrawn ? MARGIN + photoW + 24 : MARGIN;
  const descMaxW = PAGE_W - MARGIN - descX;
  let descY = blockY;
  page.drawText("DESCRIPCIÓN", {
    x: descX,
    y: descY,
    size: 8,
    font: bold,
    color: PRIMARY,
  });
  descY -= 14;
  const desc = p.short_description || p.long_description || "Sin descripción.";
  for (const line of wrapText(font, desc, 10, descMaxW).slice(0, 12)) {
    page.drawText(line, { x: descX, y: descY, size: 10, font, color: TEXT });
    descY -= 14;
  }

  y = (photoDrawn ? blockY - photoH : descY) - 30;

  // ===== Dimensiones =====
  if (p.dim_width_mm && p.dim_height_mm && p.dim_depth_mm) {
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
      color: BORDER,
    });
    y -= 30;

    drawIsoBox(
      page,
      font,
      bold,
      MARGIN + 130,
      y - 70,
      p.dim_width_mm,
      p.dim_height_mm,
      p.dim_depth_mm,
    );

    const tx = MARGIN + 280;
    let ty = y - 20;
    const dimRows: Array<[string, string]> = [
      ["Ancho", `${p.dim_width_mm} mm`],
      ["Alto", `${p.dim_height_mm} mm`],
      ["Profundo", `${p.dim_depth_mm} mm`],
    ];
    if (p.weight_grams) {
      dimRows.push(["Peso", `${(p.weight_grams / 1000).toFixed(2)} kg`]);
    }
    for (const [k, v] of dimRows) {
      page.drawText(k.toUpperCase(), { x: tx, y: ty, size: 8, font: bold, color: MUTED });
      page.drawText(v, { x: tx + 80, y: ty, size: 11, font: bold, color: TEXT });
      ty -= 18;
    }

    y -= 160;
  }

  // ===== Características =====
  if (featured.length > 0) {
    if (y < 200) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN - 20;
    }
    page.drawText("CARACTERÍSTICAS TÉCNICAS", {
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
      color: BORDER,
    });
    y -= 24;

    const colW = (PAGE_W - 2 * MARGIN - 16) / 2;
    let leftY = y;
    let rightY = y;
    let col = 0;
    for (const a of featured) {
      const xCol = col === 0 ? MARGIN : MARGIN + colW + 16;
      const startY = col === 0 ? leftY : rightY;
      const rowH = 32;
      page.drawRectangle({
        x: xCol,
        y: startY - rowH + 6,
        width: colW,
        height: rowH,
        color: col === 0 ? BG_SOFT : WHITE,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      page.drawText(a.attribute_name.toUpperCase(), {
        x: xCol + 10,
        y: startY - 6,
        size: 8,
        font: bold,
        color: MUTED,
      });
      page.drawText(valueAsText(a), {
        x: xCol + 10,
        y: startY - 22,
        size: 11,
        font: bold,
        color: TEXT,
      });
      if (col === 0) leftY -= rowH + 4;
      else rightY -= rowH + 4;
      col = (col + 1) % 2;
      if (Math.min(leftY, rightY) < 100) break;
    }
  }

  // ===== Pie =====
  const footerY = 40;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 18 },
    end: { x: PAGE_W - MARGIN, y: footerY + 18 },
    thickness: 0.5,
    color: BORDER,
  });
  const footerLeft = [
    companyName,
    fi.fiscal_tax_id ? `CIF ${fi.fiscal_tax_id}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  page.drawText(footerLeft, { x: MARGIN, y: footerY, size: 8, font, color: MUTED });
  const footerRight = [fi.fiscal_phone, fi.fiscal_email].filter(Boolean).join("  ·  ");
  if (footerRight) {
    page.drawText(footerRight, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(footerRight, 8),
      y: footerY,
      size: 8,
      font,
      color: MUTED,
    });
  }

  return await pdf.save();
}
