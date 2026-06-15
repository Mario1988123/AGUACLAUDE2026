/**
 * Generación PDF de factura compliance Verifactu.
 * Incluye QR escaneable que apunta al servicio de cotejo público AEAT.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { withSanitizer } from "@/shared/lib/pdf/dashstack";
import QRCode from "qrcode";
import { VERIFACTU_LEGAL_TEXT, NO_VERIFACTU_LEGAL_TEXT } from "./verifactu";

export interface InvoicePdfData {
  reference_code: string;
  issued_at: string;
  due_at: string | null;
  invoice_type: string;
  series_code: string;
  number: number;

  issuer: {
    legal_name: string;
    tax_id: string;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    province: string | null;
    email: string | null;
    phone: string | null;
    iban: string | null;
  };

  customer: {
    name: string;
    tax_id: string | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    province: string | null;
    email: string | null;
  };

  lines: Array<{
    description: string;
    quantity: number;
    unit_price_cents: number;
    discount_pct: number;
    tax_rate: number;
    total_cents: number;
  }>;

  taxes: Array<{
    tax_rate: number;
    base_cents: number;
    tax_cents: number;
  }>;

  subtotal_cents: number;
  tax_total_cents: number;
  retention_cents: number;
  total_cents: number;

  payment_method: string;
  notes: string | null;
  legal_notes: string | null;

  // Verifactu
  verifactu_qr_url: string;
  verifactu_hash: string;
  verifactu_mode: "no_envio" | "verifactu" | "verifactu_test";
  verifactu_csv: string | null;

  is_rectificative: boolean;
  rectifies_reference: string | null;
}

const eur = (cents: number): string =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  const helv = withSanitizer(await doc.embedFont(StandardFonts.Helvetica));
  const helvBold = withSanitizer(await doc.embedFont(StandardFonts.HelveticaBold));

  const brand = rgb(0.282, 0.502, 1); // #4880FF DashStack
  const text = rgb(0.1, 0.1, 0.15);
  const muted = rgb(0.45, 0.45, 0.5);
  const border = rgb(0.85, 0.85, 0.9);

  let y = height - 50;

  // Header — emisor
  page.drawText(data.issuer.legal_name, {
    x: 50,
    y,
    size: 18,
    font: helvBold,
    color: brand,
  });
  y -= 16;
  page.drawText(`CIF: ${data.issuer.tax_id}`, {
    x: 50,
    y,
    size: 9,
    font: helv,
    color: text,
  });
  y -= 12;
  if (data.issuer.address) {
    page.drawText(data.issuer.address, { x: 50, y, size: 9, font: helv, color: text });
    y -= 12;
  }
  if (data.issuer.postal_code || data.issuer.city) {
    page.drawText(
      `${data.issuer.postal_code ?? ""} ${data.issuer.city ?? ""} ${data.issuer.province ? `(${data.issuer.province})` : ""}`,
      { x: 50, y, size: 9, font: helv, color: text },
    );
    y -= 12;
  }
  if (data.issuer.email) {
    page.drawText(data.issuer.email, { x: 50, y, size: 9, font: helv, color: muted });
    y -= 12;
  }
  if (data.issuer.phone) {
    page.drawText(data.issuer.phone, { x: 50, y, size: 9, font: helv, color: muted });
    y -= 12;
  }

  // Caja factura nº (derecha)
  const boxX = width - 230;
  const boxY = height - 110;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: 180,
    height: 70,
    borderColor: brand,
    borderWidth: 1.5,
    color: rgb(0.95, 0.97, 1),
  });
  const invoiceLabel = data.is_rectificative ? "FACTURA RECTIFICATIVA" : "FACTURA";
  page.drawText(invoiceLabel, {
    x: boxX + 10,
    y: boxY + 50,
    size: 11,
    font: helvBold,
    color: brand,
  });
  page.drawText(data.reference_code, {
    x: boxX + 10,
    y: boxY + 32,
    size: 14,
    font: helvBold,
    color: text,
  });
  page.drawText(`Fecha: ${formatDate(data.issued_at)}`, {
    x: boxX + 10,
    y: boxY + 18,
    size: 9,
    font: helv,
    color: muted,
  });
  if (data.due_at) {
    page.drawText(`Vence: ${formatDate(data.due_at)}`, {
      x: boxX + 10,
      y: boxY + 6,
      size: 9,
      font: helv,
      color: muted,
    });
  }

  // Datos cliente (caja gris)
  y = height - 220;
  page.drawRectangle({
    x: 50,
    y: y - 70,
    width: width - 100,
    height: 70,
    borderColor: border,
    borderWidth: 1,
    color: rgb(0.97, 0.97, 0.98),
  });
  page.drawText("FACTURAR A:", {
    x: 60,
    y: y - 14,
    size: 8,
    font: helvBold,
    color: muted,
  });
  page.drawText(data.customer.name, {
    x: 60,
    y: y - 28,
    size: 11,
    font: helvBold,
    color: text,
  });
  if (data.customer.tax_id) {
    page.drawText(`NIF: ${data.customer.tax_id}`, {
      x: 60,
      y: y - 42,
      size: 9,
      font: helv,
      color: text,
    });
  }
  if (data.customer.address) {
    page.drawText(
      `${data.customer.address}, ${data.customer.postal_code ?? ""} ${data.customer.city ?? ""}`,
      { x: 60, y: y - 56, size: 9, font: helv, color: text },
    );
  }

  // Tabla de líneas
  y -= 100;
  const colX = { desc: 50, qty: 320, price: 370, tax: 430, total: 480 };

  // Cabecera tabla
  page.drawRectangle({
    x: 50,
    y: y - 4,
    width: width - 100,
    height: 22,
    color: brand,
  });
  page.drawText("Descripción", {
    x: colX.desc + 5,
    y: y + 6,
    size: 9,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Cant.", {
    x: colX.qty,
    y: y + 6,
    size: 9,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Precio", {
    x: colX.price,
    y: y + 6,
    size: 9,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("IVA", {
    x: colX.tax,
    y: y + 6,
    size: 9,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Total", {
    x: colX.total + 15,
    y: y + 6,
    size: 9,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  y -= 28;

  for (const line of data.lines) {
    if (y < 200) {
      // Pie de página antes de continuar (simplificado: no añado nueva página aquí)
      break;
    }
    page.drawText(line.description.slice(0, 50), {
      x: colX.desc + 5,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    page.drawText(String(line.quantity), {
      x: colX.qty,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    page.drawText(eur(line.unit_price_cents), {
      x: colX.price,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    page.drawText(`${line.tax_rate}%`, {
      x: colX.tax,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    page.drawText(eur(line.total_cents), {
      x: colX.total + 5,
      y,
      size: 9,
      font: helvBold,
      color: text,
    });
    y -= 16;
  }

  // Totales (derecha)
  y -= 10;
  const totX = width - 200;

  page.drawText("Subtotal:", { x: totX, y, size: 9, font: helv, color: muted });
  page.drawText(eur(data.subtotal_cents), {
    x: totX + 80,
    y,
    size: 9,
    font: helv,
    color: text,
  });
  y -= 14;

  for (const t of data.taxes) {
    page.drawText(`IVA ${t.tax_rate}%:`, {
      x: totX,
      y,
      size: 9,
      font: helv,
      color: muted,
    });
    page.drawText(eur(t.tax_cents), {
      x: totX + 80,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    y -= 14;
  }

  if (data.retention_cents > 0) {
    page.drawText("Retención IRPF:", {
      x: totX,
      y,
      size: 9,
      font: helv,
      color: muted,
    });
    page.drawText(`-${eur(data.retention_cents)}`, {
      x: totX + 80,
      y,
      size: 9,
      font: helv,
      color: text,
    });
    y -= 14;
  }

  // Total grande
  y -= 6;
  page.drawRectangle({
    x: totX - 10,
    y: y - 4,
    width: 160,
    height: 22,
    color: brand,
  });
  page.drawText("TOTAL:", {
    x: totX,
    y: y + 4,
    size: 11,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(eur(data.total_cents), {
    x: totX + 70,
    y: y + 4,
    size: 12,
    font: helvBold,
    color: rgb(1, 1, 1),
  });

  // QR Verifactu (abajo izquierda)
  if (data.verifactu_qr_url) {
    try {
      const qrPng = await QRCode.toBuffer(data.verifactu_qr_url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 150,
      });
      const qrImage = await doc.embedPng(qrPng);
      page.drawImage(qrImage, {
        x: 50,
        y: 90,
        width: 90,
        height: 90,
      });
      page.drawText("Verificar factura:", {
        x: 150,
        y: 165,
        size: 8,
        font: helvBold,
        color: muted,
      });
      page.drawText(
        data.verifactu_mode === "no_envio"
          ? NO_VERIFACTU_LEGAL_TEXT
          : VERIFACTU_LEGAL_TEXT,
        { x: 150, y: 145, size: 7, font: helv, color: muted, maxWidth: 350 },
      );
      if (data.verifactu_csv) {
        page.drawText(`CSV AEAT: ${data.verifactu_csv}`, {
          x: 150,
          y: 115,
          size: 7,
          font: helv,
          color: muted,
        });
      }
      page.drawText(`Hash: ${data.verifactu_hash.slice(0, 32)}...`, {
        x: 150,
        y: 100,
        size: 6,
        font: helv,
        color: muted,
      });
    } catch (e) {
      console.error("[invoice-pdf] QR generation failed:", e);
    }
  }

  // Pie: forma de pago + IBAN
  page.drawText(`Forma de pago: ${data.payment_method ?? "—"}`, {
    x: 50,
    y: 70,
    size: 8,
    font: helv,
    color: text,
  });
  if (data.issuer.iban) {
    page.drawText(`IBAN: ${data.issuer.iban}`, {
      x: 50,
      y: 58,
      size: 8,
      font: helv,
      color: text,
    });
  }

  // Pie LOPD
  page.drawText(
    "Conforme al RGPD, sus datos figuran en nuestros ficheros para gestión administrativa. Puede ejercer derechos ARCO en el email indicado.",
    {
      x: 50,
      y: 30,
      size: 6.5,
      font: helv,
      color: muted,
      maxWidth: width - 100,
    },
  );

  return await doc.save();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
