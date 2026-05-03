import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createAdminClient } from "@/shared/lib/supabase/admin";

interface ProductRow {
  id: string;
  name: string;
  short_description: string | null;
  internal_reference: string | null;
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

function valueAsText(v: AttrValue): string {
  if (v.data_type === "boolean") return v.value_boolean ? "Sí" : "No";
  if (v.data_type === "number" || v.data_type === "dimension") {
    if (v.value_number == null) return "—";
    return `${v.value_number}${v.unit ? " " + v.unit : ""}`;
  }
  return v.value_text ?? "—";
}

/**
 * Dibuja una caja 3D isométrica en SVG-like usando líneas pdf-lib, con cotas
 * de ancho × alto × profundo. Estilo simplificado pero claro para ficha
 * técnica.
 */
function drawIsoBox(
  page: ReturnType<PDFDocument["addPage"]>,
  font: PDFFont,
  centerX: number,
  baseY: number,
  widthMm: number,
  heightMm: number,
  depthMm: number,
) {
  // Escalar para que el lado más grande mida ~140 px
  const maxMm = Math.max(widthMm, heightMm, depthMm) || 100;
  const scale = 140 / maxMm;
  const w = widthMm * scale;
  const h = heightMm * scale;
  const d = depthMm * scale;
  // Ángulo isométrico: 30°
  const dx = d * Math.cos(Math.PI / 6);
  const dy = d * Math.sin(Math.PI / 6);

  const fg = rgb(0.2, 0.2, 0.25);
  const fill = rgb(0.9, 0.93, 1);
  const fillTop = rgb(0.78, 0.84, 1);
  const fillSide = rgb(0.66, 0.74, 0.96);

  // Vertices
  const x = centerX - w / 2 - dx / 2;
  const y = baseY;
  const A = { x: x, y: y };
  const B = { x: x + w, y: y };
  const C = { x: x + w + dx, y: y + dy };
  const D = { x: x + dx, y: y + dy };
  const E = { x: A.x, y: A.y + h };
  const F = { x: B.x, y: B.y + h };
  const G = { x: C.x, y: C.y + h };
  const H = { x: D.x, y: D.y + h };

  // Cara frontal E-F-B-A
  page.drawRectangle({
    x: A.x,
    y: A.y,
    width: w,
    height: h,
    color: fill,
    borderColor: fg,
    borderWidth: 0.8,
  });
  // Cara superior (cuadrilátero) E-F-G-H aproximada con dos líneas + relleno
  // pdf-lib no tiene polígono nativo: usamos drawSvgPath
  page.drawSvgPath(
    `M ${E.x} ${page.getHeight() - E.y} L ${F.x} ${page.getHeight() - F.y} L ${G.x} ${page.getHeight() - G.y} L ${H.x} ${page.getHeight() - H.y} Z`,
    { color: fillTop, borderColor: fg, borderWidth: 0.6 },
  );
  // Cara lateral derecha B-F-G-C
  page.drawSvgPath(
    `M ${B.x} ${page.getHeight() - B.y} L ${F.x} ${page.getHeight() - F.y} L ${G.x} ${page.getHeight() - G.y} L ${C.x} ${page.getHeight() - C.y} Z`,
    { color: fillSide, borderColor: fg, borderWidth: 0.6 },
  );

  // Cotas con texto (mm)
  const muted = rgb(0.4, 0.4, 0.45);
  // Ancho (debajo)
  page.drawText(`${widthMm} mm`, {
    x: A.x + w / 2 - 18,
    y: A.y - 14,
    size: 8,
    font,
    color: muted,
  });
  // Alto (izquierda)
  page.drawText(`${heightMm} mm`, {
    x: A.x - 38,
    y: A.y + h / 2 - 4,
    size: 8,
    font,
    color: muted,
  });
  // Profundo (arriba derecha)
  page.drawText(`${depthMm} mm`, {
    x: G.x + 4,
    y: G.y + h / 2 - 4,
    size: 8,
    font,
    color: muted,
  });
}

/** Genera la ficha técnica (PDF A4) del producto. */
export async function generateProductDatasheet(productId: string): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prod } = await admin
    .from("products")
    .select(
      "id, name, short_description, internal_reference, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams, main_image_url, category_id",
    )
    .eq("id", productId)
    .maybeSingle();
  if (!prod) throw new Error("Producto no encontrado");
  const p = prod as ProductRow;

  // Solo atributos marcados como destacados (toggle "Destacado")
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
  const list = ((attrs ?? []) as Row[]).map<AttrValue>((r) => ({
    attribute_name: r.product_attributes?.name ?? "",
    unit: r.product_attributes?.unit ?? null,
    value_text: r.value_text,
    value_number: r.value_number,
    value_boolean: r.value_boolean,
    data_type: r.data_type,
    is_featured: r.is_featured,
  }));

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const margin = 40;

  const primary = rgb(0.28, 0.5, 1);
  const fg = rgb(0.1, 0.1, 0.15);
  const muted = rgb(0.5, 0.5, 0.55);

  // Header
  page.drawText("FICHA TÉCNICA", {
    x: margin,
    y: 800,
    size: 22,
    font: bold,
    color: primary,
  });
  page.drawText(p.name, { x: margin, y: 770, size: 16, font: bold, color: fg });
  if (p.internal_reference) {
    page.drawText(`Ref. ${p.internal_reference}`, {
      x: margin,
      y: 752,
      size: 9,
      font,
      color: muted,
    });
  }

  // Foto del producto si existe
  let photoBottom = 750;
  if (p.main_image_url) {
    try {
      const res = await fetch(p.main_image_url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = p.main_image_url.toLowerCase().includes(".png")
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf);
      const targetW = 200;
      const ratio = img.height / img.width;
      const targetH = targetW * ratio;
      page.drawImage(img, {
        x: W - margin - targetW,
        y: 800 - targetH,
        width: targetW,
        height: targetH,
      });
      photoBottom = 800 - targetH;
    } catch {
      /* fail-soft: sin foto */
    }
  }

  // Descripción
  let y = Math.min(photoBottom, 740) - 10;
  if (p.short_description) {
    const lines = wrapText(p.short_description, 90);
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size: 10, font, color: fg });
      y -= 13;
    }
    y -= 8;
  }

  // Caja 3D con dimensiones
  if (p.dim_width_mm && p.dim_height_mm && p.dim_depth_mm) {
    page.drawText("DIMENSIONES", {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: muted,
    });
    y -= 18;
    drawIsoBox(
      page,
      font,
      margin + 110,
      y - 120,
      p.dim_width_mm,
      p.dim_height_mm,
      p.dim_depth_mm,
    );
    if (p.weight_grams) {
      page.drawText(`Peso: ${(p.weight_grams / 1000).toFixed(2)} kg`, {
        x: margin + 240,
        y: y - 20,
        size: 10,
        font,
        color: fg,
      });
    }
    y -= 160;
  }

  // Atributos destacados
  if (list.length > 0) {
    page.drawText("CARACTERÍSTICAS", {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: muted,
    });
    y -= 18;
    page.drawRectangle({
      x: margin,
      y: y - 4,
      width: W - 2 * margin,
      height: 18,
      color: primary,
    });
    page.drawText("CARACTERÍSTICA", {
      x: margin + 8,
      y: y + 1,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText("VALOR", {
      x: W - margin - 200,
      y: y + 1,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y -= 24;
    let zebra = false;
    for (const a of list) {
      if (zebra) {
        page.drawRectangle({
          x: margin,
          y: y - 4,
          width: W - 2 * margin,
          height: 16,
          color: rgb(0.96, 0.97, 1),
        });
      }
      zebra = !zebra;
      page.drawText(a.attribute_name, { x: margin + 8, y, size: 10, font, color: fg });
      page.drawText(valueAsText(a), {
        x: W - margin - 200,
        y,
        size: 10,
        font: bold,
        color: fg,
      });
      y -= 16;
      if (y < 80) break;
    }
  }

  // Footer
  page.drawText("Documento informativo generado por AguaClaude CRM", {
    x: margin,
    y: 30,
    size: 7,
    font,
    color: muted,
  });

  return await pdf.save();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}
