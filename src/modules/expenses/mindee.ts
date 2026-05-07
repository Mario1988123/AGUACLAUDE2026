/**
 * Cliente Mindee Receipt OCR API.
 *
 * Docs: https://developers.mindee.com/docs/receipt-ocr
 *
 * Endpoint: https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict
 *
 * Auth header: Authorization: Token {api_key}
 *
 * Plan: Free 250/mes; tras eso $0.01-0.10 según volumen.
 *
 * Si MINDEE_API_KEY no está configurada el módulo cae a entrada manual
 * (`isMindeeConfigured() === false`).
 */

const ENDPOINT =
  "https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict";

export interface MindeeReceipt {
  total_amount: number | null;
  total_net: number | null;
  total_tax: number | null;
  date: string | null;          // YYYY-MM-DD
  category: string | null;      // food, transport, accommodation, etc.
  subcategory: string | null;
  document_type: string | null; // RECEIPT | INVOICE | CREDIT_CARD_RECEIPT
  supplier_name: string | null;
  supplier_company_registrations: string[]; // CIF/NIF si lo detecta
  supplier_address: string | null;
  supplier_phone: string | null;
  receipt_number: string | null;
  taxes: Array<{ rate: number; amount: number; base: number | null }>;
  line_items: Array<{
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_amount: number | null;
  }>;
  locale_currency: string | null;
  tip: number | null;
  raw: unknown;
  confidence: number;            // 0..1, media de los campos clave
}

export function isMindeeConfigured(): boolean {
  return Boolean(process.env.MINDEE_API_KEY);
}

export async function ocrReceiptWithMindee(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<MindeeReceipt> {
  const apiKey = process.env.MINDEE_API_KEY;
  if (!apiKey) throw new Error("MINDEE_API_KEY no configurado");

  const form = new FormData();
  // Copiamos a un ArrayBuffer fresco para evitar incompatibilidad
  // SharedArrayBuffer/ArrayBuffer que TS detecta con `Buffer`.
  const ab = new ArrayBuffer(fileBuffer.byteLength);
  new Uint8Array(ab).set(fileBuffer);
  const blob = new Blob([ab], { type: mimeType });
  form.append("document", blob, filename);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mindee error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as MindeeApiResponse;
  return parseMindeeResponse(data);
}

interface FieldNum {
  value: number | null;
  confidence: number;
}
interface FieldStr {
  value: string | null;
  confidence: number;
}

interface MindeeApiResponse {
  document?: {
    inference?: {
      prediction?: {
        total_amount?: FieldNum;
        total_net?: FieldNum;
        total_tax?: FieldNum;
        date?: FieldStr;
        category?: FieldStr;
        subcategory?: FieldStr;
        document_type?: FieldStr;
        supplier_name?: FieldStr;
        supplier_company_registrations?: Array<{ value: string; type: string }>;
        supplier_address?: FieldStr;
        supplier_phone_number?: FieldStr;
        receipt_number?: FieldStr;
        taxes?: Array<{ rate: number; value: number; base?: number | null }>;
        line_items?: Array<{
          description?: string | null;
          quantity?: number | null;
          unit_price?: number | null;
          total_amount?: number | null;
        }>;
        locale?: { currency?: string | null };
        tip?: FieldNum;
      };
    };
  };
}

function parseMindeeResponse(data: MindeeApiResponse): MindeeReceipt {
  const p = data.document?.inference?.prediction ?? {};
  const conf = (f?: FieldNum | FieldStr) => f?.confidence ?? 0;
  const confidences = [
    conf(p.total_amount),
    conf(p.date),
    conf(p.supplier_name),
  ].filter((c) => c > 0);
  const avg =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

  return {
    total_amount: p.total_amount?.value ?? null,
    total_net: p.total_net?.value ?? null,
    total_tax: p.total_tax?.value ?? null,
    date: p.date?.value ?? null,
    category: p.category?.value ?? null,
    subcategory: p.subcategory?.value ?? null,
    document_type: p.document_type?.value ?? null,
    supplier_name: p.supplier_name?.value ?? null,
    supplier_company_registrations: (p.supplier_company_registrations ?? []).map(
      (r) => r.value,
    ),
    supplier_address: p.supplier_address?.value ?? null,
    supplier_phone: p.supplier_phone_number?.value ?? null,
    receipt_number: p.receipt_number?.value ?? null,
    taxes: (p.taxes ?? []).map((t) => ({
      rate: t.rate,
      amount: t.value,
      base: t.base ?? null,
    })),
    line_items: (p.line_items ?? []).map((l) => ({
      description: l.description ?? null,
      quantity: l.quantity ?? null,
      unit_price: l.unit_price ?? null,
      total_amount: l.total_amount ?? null,
    })),
    locale_currency: p.locale?.currency ?? null,
    tip: p.tip?.value ?? null,
    raw: data,
    confidence: avg,
  };
}

/**
 * Mapea la categoría devuelta por Mindee a un code de nuestra taxonomía.
 * Mindee usa: food, transport, toll, accommodation, gasoline, parking, etc.
 */
export function mapMindeeCategoryToOurs(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase();
  const map: Record<string, string> = {
    food: "meal_self",
    restaurant: "meal_self",
    transport: "taxi",
    toll: "tolls",
    accommodation: "hotel",
    lodging: "hotel",
    gasoline: "fuel",
    fuel: "fuel",
    parking: "parking",
    taxi: "taxi",
    flight: "plane",
    train: "public_transport",
  };
  return map[c] ?? null;
}
