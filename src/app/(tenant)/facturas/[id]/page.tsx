import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/modules/invoices/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { InvoiceActions } from "@/modules/invoices/invoice-actions";
import { SendByEmailButton } from "@/modules/mailing/send-by-email-button";
import { listActiveMandatesForCustomer } from "@/modules/gocardless/actions";
import { ChargeWithGoCardlessButton } from "@/modules/gocardless/charge-button";
import { BackButton } from "@/shared/components/back-button";
import { PaymentReminderButton } from "@/modules/invoices/payment-reminder-button";
import { suggestReminderLevel } from "@/modules/invoices/payment-reminder-actions";
import { createClient } from "@/shared/lib/supabase/server";
import { VerifactuV2Actions } from "@/modules/invoices/verifactu-v2-actions";

function eur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  proforma: "Proforma",
  issued: "Emitida",
  paid: "Cobrada",
  overdue: "Vencida",
  void: "Anulada",
  cancelled: "Cancelada",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  proforma: "secondary",
  issued: "default",
  paid: "success",
  overdue: "destructive",
  void: "secondary",
  cancelled: "secondary",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let inv;
  try {
    inv = await getInvoice(id);
  } catch {
    notFound();
  }
  const gcMandates = await listActiveMandatesForCustomer(inv.customer_id).catch(() => []);

  // Email del cliente para mailto del recordatorio + verifactu_mode empresa
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any;
  let customerEmail: string | null = null;
  let verifactuMode: "no_envio" | "verifactu_test" | "verifactu" = "no_envio";
  try {
    const { data } = await sb
      .from("customers")
      .select("email")
      .eq("id", inv.customer_id)
      .maybeSingle();
    customerEmail = (data as { email: string | null } | null)?.email ?? null;
  } catch {
    /* */
  }
  try {
    const { data: cs } = await sb
      .from("company_settings")
      .select("verifactu_mode")
      .maybeSingle();
    const m = (cs as { verifactu_mode: string | null } | null)?.verifactu_mode;
    if (m === "verifactu_test" || m === "verifactu") verifactuMode = m;
  } catch {
    /* */
  }

  // Días de vencimiento (negativo = vencida)
  let daysOverdue = 0;
  if (inv.due_date) {
    const due = new Date(inv.due_date);
    daysOverdue = Math.floor((Date.now() - due.getTime()) / 86400000);
  }
  const suggestedLevel =
    inv.pending_cents > 0
      ? await suggestReminderLevel({
          invoice_id: inv.id,
          days_overdue: daysOverdue,
        }).catch(() => "first" as const)
      : ("first" as const);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Factura {inv.full_reference}</h1>
            <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Para <strong>{inv.customer_name}</strong>
            {inv.contract_id && (
              <>
                {" · "}
                <Link
                  href={`/contratos/${inv.contract_id}` as never}
                  className="text-primary hover:underline"
                >
                  Ver contrato
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/pdf/invoice/${inv.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 PDF
          </a>
          <SendByEmailButton documentId={inv.id} kind="invoice" short />
          <BackButton href="/facturas" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Líneas</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Descripción</th>
                  <th className="py-2 text-right">Cant.</th>
                  <th className="py-2 text-right">Precio</th>
                  <th className="py-2 text-right">Dto%</th>
                  <th className="py-2 text-right">IVA%</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inv.lines.map((l, idx) => {
                  const subtotal = l.unit_price_cents * l.quantity * (1 - l.discount_percent / 100);
                  return (
                    <tr key={l.id ?? idx}>
                      <td className="py-2">{l.description}</td>
                      <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{eur(l.unit_price_cents)}</td>
                      <td className="py-2 text-right tabular-nums">{l.discount_percent}%</td>
                      <td className="py-2 text-right tabular-nums">{l.tax_rate_percent}%</td>
                      <td className="py-2 text-right tabular-nums">{eur(subtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={5} className="py-2 text-right text-muted-foreground">
                    Subtotal
                  </td>
                  <td className="py-2 text-right tabular-nums">{eur(inv.subtotal_cents)}</td>
                </tr>
                <tr>
                  <td colSpan={5} className="py-2 text-right text-muted-foreground">
                    IVA
                  </td>
                  <td className="py-2 text-right tabular-nums">{eur(inv.tax_cents)}</td>
                </tr>
                <tr className="border-t font-bold">
                  <td colSpan={5} className="py-3 text-right">
                    Total
                  </td>
                  <td className="py-3 text-right tabular-nums text-lg">{eur(inv.total_cents)}</td>
                </tr>
                {inv.pending_cents > 0 && inv.status !== "draft" && (
                  <tr>
                    <td colSpan={5} className="py-2 text-right text-red-600">
                      Pendiente
                    </td>
                    <td className="py-2 text-right tabular-nums text-red-600 font-bold">
                      {eur(inv.pending_cents)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <InvoiceActions
              invoiceId={inv.id}
              status={inv.status}
              kind={inv.kind}
              pendingCents={inv.pending_cents}
            />
            {/* Cobro por GoCardless: solo si la factura NO está pagada
                (status !== paid) y hay importe pendiente. Antes salía si
                pending_cents > 0 — pero con redondeos de IVA podía dar
                1 céntimo pendiente en facturas ya cobradas (creadas
                desde un wallet validated). */}
            {inv.status !== "paid" &&
              inv.status !== "draft" &&
              inv.status !== "cancelled" &&
              inv.pending_cents > 5 && (
                <div className="mt-3 border-t pt-3">
                  <ChargeWithGoCardlessButton
                    mandates={gcMandates}
                    defaultAmountCents={inv.pending_cents}
                    description={`Factura ${inv.full_reference}`}
                    invoiceId={inv.id}
                    size="sm"
                  />
                </div>
              )}
            {inv.pending_cents > 0 &&
              inv.status !== "draft" &&
              inv.status !== "cancelled" &&
              customerEmail && (
                <div className="mt-3 border-t pt-3">
                  <PaymentReminderButton
                    invoiceId={inv.id}
                    invoiceRef={inv.full_reference}
                    customerName={inv.customer_name ?? "Cliente"}
                    customerEmail={customerEmail}
                    totalCents={inv.pending_cents}
                    daysOverdue={daysOverdue}
                    suggestedLevel={suggestedLevel}
                  />
                </div>
              )}
            {(verifactuMode === "verifactu_test" || verifactuMode === "verifactu") && (
              <div className="mt-3 border-t pt-3">
                <VerifactuV2Actions
                  invoiceId={inv.id}
                  status={inv.status}
                  mode={verifactuMode}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {inv.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cobros</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-semibold">{eur(p.amount_cents)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.paid_at).toLocaleString("es-ES")}
                      {p.notes && ` · ${p.notes}`}
                    </div>
                  </div>
                  {p.wallet_entry_id && (
                    <Badge variant="outline" className="text-xs">
                      Wallet
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {inv.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{inv.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
