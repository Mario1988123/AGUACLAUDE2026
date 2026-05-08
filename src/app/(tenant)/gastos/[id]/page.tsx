import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getExpenseReceiptUrl } from "@/modules/expenses/actions";
import { ApprovalButtons } from "@/modules/expenses/approval-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  submitted: "Pendiente de aprobar",
  approved: "Aprobado · pdte. liquidar",
  rejected: "Rechazado",
  reimbursed: "Liquidado",
  reconciled: "Validado (tarjeta empresa)",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  submitted: "warning",
  approved: "default",
  rejected: "destructive",
  reimbursed: "success",
  reconciled: "success",
};

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  if (!session.company_id) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("expenses")
    .select(
      "*, expense_categories(name, code, vat_deductible), customers(legal_name, trade_name, first_name, last_name)",
    )
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = data as any;
  if (!e) notFound();
  // Nombre del comercial via user_profiles (auth.users → user_profiles.user_id)
  let userName: string | null = null;
  if (e.user_id) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("full_name, email")
      .eq("user_id", e.user_id)
      .maybeSingle();
    const p = profile as { full_name: string | null; email: string | null } | null;
    userName = p?.full_name ?? p?.email ?? null;
  }

  const receiptUrl = await getExpenseReceiptUrl(id).catch(() => null);
  const customerName =
    e.customers?.trade_name ||
    e.customers?.legal_name ||
    [e.customers?.first_name, e.customers?.last_name].filter(Boolean).join(" ") ||
    null;
  const isApprover =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");

  const PAYMENT_LABEL: Record<string, string> = {
    corp_card: `Tarjeta empresa${e.corp_card_last4 ? ` ····${e.corp_card_last4}` : ""}`,
    personal: "Dinero propio (reembolso)",
    cash: "Efectivo empresa",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {e.merchant_name ?? "Gasto sin comercio"}
            </h1>
            <Badge variant={STATUS_VARIANT[e.status]}>
              {STATUS_LABEL[e.status] ?? e.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {e.expense_categories?.name ?? "Sin categoría"} · {eur(e.total_cents)} ·{" "}
            {userName ?? "(comercial)"}
          </p>
        </div>
        <Link href="/gastos" className="text-sm text-primary hover:underline self-center">
          ← Volver
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Detalle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Establecimiento" value={e.merchant_name ?? "—"} />
            <Field label="NIF/CIF emisor" value={e.merchant_nif ?? "—"} />
            <Field
              label="Fecha"
              value={e.issue_date ? new Date(e.issue_date).toLocaleDateString("es-ES") : "—"}
            />
            <Field
              label="Tipo de documento"
              value={
                e.document_type === "ticket_simple"
                  ? "Ticket simplificado"
                  : e.document_type === "invoice_simple_qualified"
                    ? "Factura simplificada con NIF"
                    : "Factura completa"
              }
            />
            {e.document_number && (
              <Field label="Nº documento" value={e.document_number} />
            )}
            <Field label="Total" value={eur(e.total_cents)} />
            {e.base_cents != null && <Field label="Base" value={eur(e.base_cents)} />}
            {e.vat_cents != null && (
              <Field
                label="IVA"
                value={`${eur(e.vat_cents)} ${e.expense_categories?.vat_deductible === false ? "(no deducible)" : ""}`}
              />
            )}
            <Field label="Forma de pago" value={PAYMENT_LABEL[e.payment_method] ?? e.payment_method} />
            <Field label="Cliente asociado" value={customerName ?? "—"} />
            {e.notes && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Notas
                </div>
                <p className="mt-1 whitespace-pre-wrap">{e.notes}</p>
              </div>
            )}
            {e.rejection_reason && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-xs font-bold uppercase text-destructive">Motivo del rechazo</div>
                <p className="mt-1">{e.rejection_reason}</p>
              </div>
            )}
            {e.reimbursed_at && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                <div className="text-xs font-bold uppercase">Liquidación</div>
                <p className="mt-1">
                  Reembolsados <strong>{eur(e.reimbursed_amount_cents ?? 0)}</strong> el{" "}
                  {new Date(e.reimbursed_at).toLocaleDateString("es-ES")}.
                </p>
                {e.bank_transaction_ref && (
                  <p className="text-xs">Ref. bancaria: {e.bank_transaction_ref}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Acciones</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalButtons
                expenseId={id}
                status={e.status}
                paymentMethod={e.payment_method}
                totalCents={e.total_cents}
                canApprove={isApprover}
              />
            </CardContent>
          </Card>

          {receiptUrl && (
            <Card>
              <CardHeader>
                <CardTitle>Recibo</CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" /> Abrir recibo
                </a>
                {e.receipt_mime?.startsWith("image/") && (
                  <a href={receiptUrl} target="_blank" rel="noopener" className="mt-3 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={receiptUrl}
                      alt="Recibo"
                      className="rounded-xl border max-h-96 object-contain w-full"
                    />
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
