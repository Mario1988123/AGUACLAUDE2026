import { NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { generateInvoicePdf } from "@/modules/invoices/verifactu-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: inv } = await admin
    .from("invoices")
    .select(
      `id, company_id, reference_code, number, invoice_type, status,
       customer_id, customer_snapshot, issued_at, due_at,
       subtotal_cents, tax_total_cents, retention_cents, total_cents,
       payment_method, notes, legal_notes,
       verifactu_qr_url, verifactu_hash, verifactu_csv,
       is_rectificative, rectifies_invoice_id,
       series:invoice_series(code)`,
    )
    .eq("id", id)
    .single();
  if (!inv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Verificar empresa
  if (!session.is_superadmin && inv.company_id !== session.company_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: cs } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_email, fiscal_phone, fiscal_iban, verifactu_mode",
    )
    .eq("company_id", inv.company_id)
    .maybeSingle();

  const { data: lines } = await admin
    .from("invoice_lines")
    .select(
      "description, quantity, unit_price_cents, discount_pct, tax_rate, total_cents",
    )
    .eq("invoice_id", id)
    .order("display_order");

  const { data: taxes } = await admin
    .from("invoice_taxes")
    .select("tax_rate, base_cents, tax_cents")
    .eq("invoice_id", id)
    .order("tax_rate", { ascending: false });

  let rectifiesRef: string | null = null;
  if (inv.is_rectificative && inv.rectifies_invoice_id) {
    const { data: ref } = await admin
      .from("invoices")
      .select("reference_code")
      .eq("id", inv.rectifies_invoice_id)
      .maybeSingle();
    rectifiesRef = ref?.reference_code ?? null;
  }

  const customerSnap = inv.customer_snapshot as Record<string, unknown>;

  const pdf = await generateInvoicePdf({
    reference_code: inv.reference_code ?? "(sin numerar)",
    issued_at: inv.issued_at ?? new Date().toISOString(),
    due_at: inv.due_at,
    invoice_type: inv.invoice_type,
    series_code: (inv.series as { code?: string })?.code ?? "",
    number: inv.number ?? 0,
    issuer: {
      legal_name: cs?.fiscal_legal_name ?? "—",
      tax_id: cs?.fiscal_tax_id ?? "—",
      address: cs?.fiscal_street ?? null,
      postal_code: cs?.fiscal_postal_code ?? null,
      city: cs?.fiscal_city ?? null,
      province: cs?.fiscal_province ?? null,
      email: cs?.fiscal_email ?? null,
      phone: cs?.fiscal_phone ?? null,
      iban: cs?.fiscal_iban ?? null,
    },
    customer: {
      name:
        (customerSnap.trade_name as string) ||
        (customerSnap.legal_name as string) ||
        `${customerSnap.first_name ?? ""} ${customerSnap.last_name ?? ""}`.trim() ||
        "Cliente",
      tax_id: (customerSnap.tax_id as string) ?? null,
      address: (customerSnap.address as string) ?? null,
      postal_code: (customerSnap.postal_code as string) ?? null,
      city: (customerSnap.city as string) ?? null,
      province: (customerSnap.province as string) ?? null,
      email: (customerSnap.email as string) ?? null,
    },
    lines: (lines ?? []) as Array<{
      description: string;
      quantity: number;
      unit_price_cents: number;
      discount_pct: number;
      tax_rate: number;
      total_cents: number;
    }>,
    taxes: (taxes ?? []) as Array<{
      tax_rate: number;
      base_cents: number;
      tax_cents: number;
    }>,
    subtotal_cents: inv.subtotal_cents,
    tax_total_cents: inv.tax_total_cents,
    retention_cents: inv.retention_cents,
    total_cents: inv.total_cents,
    payment_method: inv.payment_method ?? "Transferencia",
    notes: inv.notes,
    legal_notes: inv.legal_notes,
    verifactu_qr_url: inv.verifactu_qr_url ?? "",
    verifactu_hash: inv.verifactu_hash ?? "",
    verifactu_mode: cs?.verifactu_mode ?? "no_envio",
    verifactu_csv: inv.verifactu_csv,
    is_rectificative: inv.is_rectificative,
    rectifies_reference: rectifiesRef,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.reference_code ?? "factura"}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
