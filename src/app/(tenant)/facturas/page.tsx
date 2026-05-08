import Link from "next/link";
import { listInvoices } from "@/modules/invoices/actions";
import { listPendingInvoiceWalletEntries } from "@/modules/wallet/actions";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { Badge } from "@/shared/ui/badge";
import { GenerateMonthlyButton } from "@/modules/invoices/generate-monthly-button";
import { InvoiceFromWalletButton } from "@/modules/wallet/invoice-from-wallet-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  proforma: "Proforma",
  issued: "Emitida",
  paid: "Cobrada",
  overdue: "Vencida",
  void: "Anulada",
  cancelled: "Cancelada",
};

const KIND_LABEL: Record<string, string> = {
  invoice: "Factura",
  credit_note: "Rectificativa",
  proforma: "Proforma",
  delivery_note: "Albarán",
};

const STATUS_TONE: Record<string, "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"> =
  {
    draft: "neutral",
    proforma: "info",
    issued: "info",
    paid: "success",
    overdue: "rejected",
    void: "neutral",
    cancelled: "neutral",
  };

function eur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export default async function InvoicesPage() {
  const [invoices, pendingInvoice] = await Promise.all([
    listInvoices(),
    listPendingInvoiceWalletEntries(),
  ]);

  const totalPending = invoices
    .filter((i) => i.status === "issued" || i.status === "overdue")
    .reduce((s, i) => s + i.pending_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Facturas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoices.length} facturas · pendiente de cobro {eur(totalPending)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GenerateMonthlyButton />
          <Button asChild>
            <Link href={"/facturas/nueva" as never}>+ Nueva factura</Link>
          </Button>
        </div>
      </div>

      {pendingInvoice.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pendientes de facturar ({pendingInvoice.length})
              <Badge variant="warning">{eur(pendingInvoice.reduce((s, p) => s + p.amount_cents, 0))}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Cobros del wallet ya cobrados pero sin factura emitida. Pulsa «Facturar» para crear
              borrador con IVA 21% (luego puedes ajustar).
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Cobrado</th>
                    <th className="py-2 text-left">Cliente</th>
                    <th className="py-2 text-left">Contrato</th>
                    <th className="py-2 text-left">Concepto</th>
                    <th className="py-2 text-right">Importe</th>
                    <th className="py-2 text-left">Comercial</th>
                    <th className="py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pendingInvoice.map((p) => (
                    <tr key={p.id} className="hover:bg-amber-100/50">
                      <td className="py-2 text-xs">
                        {p.collected_at
                          ? new Date(p.collected_at).toLocaleDateString("es-ES")
                          : "—"}
                      </td>
                      <td className="py-2">
                        {p.customer_id ? (
                          <Link
                            href={`/clientes/${p.customer_id}` as never}
                            className="font-medium hover:underline"
                          >
                            {p.customer_name ?? "Cliente"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {p.contract_reference ? (
                          <Link
                            href={`/contratos/${p.contract_id}` as never}
                            className="text-primary hover:underline"
                          >
                            {p.contract_reference}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-xs">{p.concept}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {eur(p.amount_cents)}
                      </td>
                      <td className="py-2 text-xs">{p.collected_by_name ?? "—"}</td>
                      <td className="py-2 text-right">
                        <InvoiceFromWalletButton walletId={p.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay facturas. Pulsa &laquo;Nueva factura&raquo; o genera la mensualidad
              automática de los contratos recurrentes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Ref</th>
                    <th className="py-2 text-left">Tipo</th>
                    <th className="py-2 text-left">Cliente</th>
                    <th className="py-2 text-left">Emitida</th>
                    <th className="py-2 text-left">Vence</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Pendiente</th>
                    <th className="py-2 text-left">Estado</th>
                    <th className="py-2 text-right">Ver</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30">
                      <td className="py-2 font-mono text-xs">
                        <Link
                          href={`/facturas/${i.id}` as never}
                          className="text-primary hover:underline"
                        >
                          {i.full_reference}
                        </Link>
                      </td>
                      <td className="py-2 text-xs">{KIND_LABEL[i.kind] ?? i.kind}</td>
                      <td className="py-2">{i.customer_name ?? "—"}</td>
                      <td className="py-2 text-xs">
                        {new Date(i.issue_date).toLocaleDateString("es-ES")}
                      </td>
                      <td className="py-2 text-xs">
                        {i.due_date ? new Date(i.due_date).toLocaleDateString("es-ES") : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums font-semibold">
                        {eur(i.total_cents)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {i.pending_cents > 0 ? (
                          <span className="text-red-600">{eur(i.pending_cents)}</span>
                        ) : (
                          <span className="text-emerald-600">0,00 €</span>
                        )}
                      </td>
                      <td className="py-2">
                        <StatusPill
                          label={STATUS_LABEL[i.status] ?? i.status}
                          tone={STATUS_TONE[i.status] ?? "info"}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/facturas/${i.id}` as never}
                          className="text-xs text-primary hover:underline"
                        >
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
