import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getInvoice } from "./actions";

function eur(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES");
}

interface DrawTextOpts {
  size?: number;
  bold?: boolean;
  color?: { r: number; g: number; b: number };
  maxWidth?: number;
}

/**
 * Genera el PDF "típico" de factura: cabecera con emisora + receptor,
 * tabla de líneas, totales, pie legal.
 */
export async function generateInvoicePdf(invoiceId: string): Promise<Uint8Array> {
  const inv = await getInvoice(invoiceId);
  const company = (inv.company_fiscal_snapshot ?? {}) as Record<string, string | null>;
  const customer = (inv.customer_fiscal_snapshot ?? {}) as Record<string, unknown>;

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595;
  const margin = 40;
  let y = 800;
  const primary = { r: 0.28, g: 0.5, b: 1 }; // azul DashStack
  const fg = { r: 0.1, g: 0.1, b: 0.15 };
  const muted = { r: 0.5, g: 0.5, b: 0.55 };

  function text(s: string, x: number, yPos: number, opts: DrawTextOpts = {}): void {
    const f: PDFFont = opts.bold ? bold : font;
    const c = opts.color ?? fg;
    page.drawText(s, {
      x,
      y: yPos,
      size: opts.size ?? 10,
      font: f,
      color: rgb(c.r, c.g, c.b),
      maxWidth: opts.maxWidth,
    });
  }

  // Header: tipo doc + ref
  const titleByKind = {
    invoice: "FACTURA",
    credit_note: "FACTURA RECTIFICATIVA",
    proforma: "PROFORMA",
    delivery_note: "ALBARÁN",
  } as const;
  text(titleByKind[inv.kind] ?? "FACTURA", margin, y, { size: 22, bold: true, color: primary });
  text(inv.full_reference, W - margin - 130, y, { size: 14, bold: true });
  y -= 8;
  text(`Fecha emisión: ${formatDate(inv.issue_date)}`, W - margin - 200, y, { size: 9, color: muted });
  y -= 12;
  if (inv.due_date) {
    text(`Vencimiento: ${formatDate(inv.due_date)}`, W - margin - 200, y, { size: 9, color: muted });
  }

  y = 740;

  // Bloque emisora
  text("EMISOR", margin, y, { size: 8, bold: true, color: muted });
  y -= 14;
  text(company.fiscal_legal_name ?? "(sin razón social configurada)", margin, y, {
    bold: true,
    size: 11,
  });
  y -= 12;
  if (company.fiscal_tax_id) {
    text(`CIF: ${company.fiscal_tax_id}`, margin, y, { size: 9 });
    y -= 11;
  }
  if (company.fiscal_street) {
    text(company.fiscal_street, margin, y, { size: 9 });
    y -= 11;
  }
  const cpc = [company.fiscal_postal_code, company.fiscal_city, company.fiscal_province]
    .filter(Boolean)
    .join(" · ");
  if (cpc) {
    text(cpc, margin, y, { size: 9 });
    y -= 11;
  }
  if (company.fiscal_email) {
    text(company.fiscal_email, margin, y, { size: 9 });
    y -= 11;
  }
  if (company.fiscal_phone) {
    text(`Tel ${company.fiscal_phone}`, margin, y, { size: 9 });
    y -= 11;
  }

  // Bloque receptor
  let yR = 740;
  const xR = W / 2 + 10;
  text("RECEPTOR", xR, yR, { size: 8, bold: true, color: muted });
  yR -= 14;
  const custName =
    (customer.party_kind === "company"
      ? (customer.trade_name as string) || (customer.legal_name as string)
      : `${(customer.first_name as string) ?? ""} ${(customer.last_name as string) ?? ""}`.trim()) ||
    "Cliente";
  text(custName, xR, yR, { bold: true, size: 11 });
  yR -= 12;
  if (customer.tax_id) {
    text(`DNI/CIF: ${customer.tax_id}`, xR, yR, { size: 9 });
    yR -= 11;
  }
  const addr = customer.address as
    | { street: string | null; postal_code: string | null; city: string | null; province: string | null }
    | undefined;
  if (addr?.street) {
    text(addr.street, xR, yR, { size: 9, maxWidth: W - xR - margin });
    yR -= 11;
  }
  const addrLine = [addr?.postal_code, addr?.city, addr?.province].filter(Boolean).join(" · ");
  if (addrLine) {
    text(addrLine, xR, yR, { size: 9 });
    yR -= 11;
  }
  if (customer.email) {
    text(String(customer.email), xR, yR, { size: 9 });
    yR -= 11;
  }
  if (customer.phone_primary) {
    text(`Tel ${customer.phone_primary}`, xR, yR, { size: 9 });
    yR -= 11;
  }

  y = Math.min(y, yR) - 24;

  // Tabla cabecera
  page.drawRectangle({
    x: margin,
    y: y - 4,
    width: W - 2 * margin,
    height: 18,
    color: rgb(primary.r, primary.g, primary.b),
  });
  text("DESCRIPCIÓN", margin + 8, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  text("CANT", margin + 280, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  text("PRECIO", margin + 330, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  text("DTO%", margin + 390, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  text("IVA%", margin + 430, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  text("SUBTOTAL", W - margin - 70, y + 1, { size: 9, bold: true, color: { r: 1, g: 1, b: 1 } });
  y -= 24;

  // Líneas
  let zebra = false;
  for (const l of inv.lines) {
    if (y < 140) {
      page = pdf.addPage([595, 842]);
      y = 780;
    }
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
    const subtotal = l.unit_price_cents * l.quantity * (1 - l.discount_percent / 100);
    text(l.description.slice(0, 50), margin + 8, y, { size: 9 });
    text(String(l.quantity), margin + 280, y, { size: 9 });
    text(eur(l.unit_price_cents), margin + 330, y, { size: 9 });
    text(`${l.discount_percent}%`, margin + 390, y, { size: 9 });
    text(`${l.tax_rate_percent}%`, margin + 430, y, { size: 9 });
    text(eur(subtotal), W - margin - 70, y, { size: 9 });
    y -= 16;
  }

  y -= 20;
  // Totales
  const xTot = W - margin - 200;
  const wTot = 200;
  page.drawLine({
    start: { x: xTot, y: y + 14 },
    end: { x: xTot + wTot, y: y + 14 },
    thickness: 0.5,
    color: rgb(muted.r, muted.g, muted.b),
  });
  text("Subtotal:", xTot, y, { size: 10, color: muted });
  text(eur(inv.subtotal_cents), xTot + wTot - 70, y, { size: 10 });
  y -= 14;
  text("IVA:", xTot, y, { size: 10, color: muted });
  text(eur(inv.tax_cents), xTot + wTot - 70, y, { size: 10 });
  if (inv.withholdings_cents > 0) {
    y -= 14;
    text("Retención IRPF:", xTot, y, { size: 10, color: muted });
    text(`-${eur(inv.withholdings_cents)}`, xTot + wTot - 70, y, { size: 10 });
  }
  y -= 18;
  page.drawRectangle({
    x: xTot,
    y: y - 4,
    width: wTot,
    height: 22,
    color: rgb(primary.r, primary.g, primary.b),
  });
  text("TOTAL:", xTot + 8, y + 4, { size: 12, bold: true, color: { r: 1, g: 1, b: 1 } });
  text(eur(inv.total_cents - inv.withholdings_cents), xTot + wTot - 80, y + 4, {
    size: 14,
    bold: true,
    color: { r: 1, g: 1, b: 1 },
  });

  // Pie
  if (company.fiscal_iban) {
    text(`Forma de pago: transferencia a ${company.fiscal_iban}`, margin, 80, {
      size: 9,
      color: muted,
    });
  }
  if (company.invoice_footer_text) {
    text(String(company.invoice_footer_text).slice(0, 200), margin, 60, {
      size: 8,
      color: muted,
      maxWidth: W - 2 * margin,
    });
  }
  if (company.fiscal_mercantile_reg) {
    text(String(company.fiscal_mercantile_reg).slice(0, 200), margin, 40, {
      size: 7,
      color: muted,
      maxWidth: W - 2 * margin,
    });
  }

  return await pdf.save();
}
