import Link from "next/link";
import { Eye, Download } from "lucide-react";
import { listInvoices } from "@/modules/invoices/actions";
import { listPendingInvoiceWalletEntries } from "@/modules/wallet/actions";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { Badge } from "@/shared/ui/badge";
import { GenerateMonthlyButton } from "@/modules/invoices/generate-monthly-button";
import { InvoiceFromWalletButton } from "@/modules/wallet/invoice-from-wallet-button";
import {
  getVerifactuQueue,
  VerifactuQueueCard,
} from "@/modules/invoices/verifactu-queue-card";
import { Pagination } from "@/shared/components/pagination";
import { InvoiceRowActions } from "@/modules/invoices/row-actions";
import { requireSession } from "@/shared/lib/auth/session";
import {
  InvoiceSmartAlerts,
  getInvoiceAlerts,
} from "@/modules/invoices/smart-alerts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;
  const [invoices, pendingInvoice, vfQueue, alerts] = await Promise.all([
    listInvoices({ limit: PAGE_SIZE + 1, offset }),
    listPendingInvoiceWalletEntries(),
    getVerifactuQueue().catch(() => ({ pending: [], failed: [] })),
    isUpper ? getInvoiceAlerts().catch(() => null) : Promise.resolve(null),
  ]);
  const hasMore = invoices.length > PAGE_SIZE;
  const visibleInvoices = invoices.slice(0, PAGE_SIZE);

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

      {isUpper && alerts && <InvoiceSmartAlerts alerts={alerts} />}

      {/* KPIs cabecera facturas (decisión 2026-05-20) */}
      {(() => {
        const now = new Date();
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const issuedYTD = invoices.filter(
          (i) =>
            i.status !== "draft" &&
            i.status !== "cancelled" &&
            i.status !== "void" &&
            new Date(i.issue_date) >= yearStart,
        );
        const totalYTD = issuedYTD.reduce((s, i) => s + (i.total_cents ?? 0), 0);
        const overdue = invoices.filter(
          (i) =>
            (i.status === "overdue" || i.status === "issued") &&
            i.due_date &&
            new Date(i.due_date) < now &&
            (i.pending_cents ?? i.total_cents ?? 0) > 0,
        );
        const overdueCents = overdue.reduce(
          (s, i) => s + (i.pending_cents ?? i.total_cents ?? 0),
          0,
        );
        const pendingCents = invoices
          .filter(
            (i) =>
              i.status !== "paid" &&
              i.status !== "cancelled" &&
              i.status !== "void" &&
              i.status !== "draft",
          )
          .reduce((s, i) => s + (i.pending_cents ?? i.total_cents ?? 0), 0);
        return (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Facturado YTD</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">{eur(totalYTD)}</div>
              <div className="text-[11px] text-muted-foreground">{issuedYTD.length} facturas</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Pendiente de cobro</div>
              <div className="mt-1 text-2xl font-extrabold tabular-nums">{eur(pendingCents)}</div>
            </div>
            <div className={`rounded-xl border p-4 ${overdue.length > 0 ? "border-red-300 bg-red-50" : "bg-card"}`}>
              <div className="text-xs uppercase text-muted-foreground">Vencidas impagadas</div>
              <div className={`mt-1 text-2xl font-extrabold tabular-nums ${overdue.length > 0 ? "text-red-700" : ""}`}>
                {eur(overdueCents)}
              </div>
              <div className="text-[11px] text-muted-foreground">{overdue.length} facturas</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Total emitidas</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{invoices.length}</div>
            </div>
          </div>
        );
      })()}

      <VerifactuQueueCard
        pending={vfQueue.pending}
        failed={vfQueue.failed}
      />

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
            {/* Mobile: cards verticales — Desktop: tabla densa */}
            <ul className="space-y-2 md:hidden">
              {pendingInvoice.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-amber-200 bg-white p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {p.customer_id ? (
                          <Link
                            href={`/clientes/${p.customer_id}` as never}
                            className="hover:underline"
                          >
                            {p.customer_name ?? "Cliente"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.concept}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="font-bold">{eur(p.amount_cents)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.collected_at
                          ? new Date(p.collected_at).toLocaleDateString("es-ES")
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.contract_reference && (
                        <Link
                          href={`/contratos/${p.contract_id}` as never}
                          className="font-mono text-primary hover:underline"
                        >
                          {p.contract_reference}
                        </Link>
                      )}
                      {p.collected_by_name && (
                        <span className="text-muted-foreground">
                          · {p.collected_by_name}
                        </span>
                      )}
                    </div>
                    <InvoiceFromWalletButton walletId={p.id} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
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
          {visibleInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay facturas. Pulsa &laquo;Nueva factura&raquo; o genera la mensualidad
              automática de los contratos recurrentes.
            </p>
          ) : (
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {visibleInvoices.map((i) => (
                <li
                  key={i.id}
                  className="rounded-xl border bg-card p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/facturas/${i.id}` as never}
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                      >
                        {i.full_reference}
                      </Link>
                      {i.is_maintenance_remesa && (
                        <span className="ml-1.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                          REMESA {i.billing_period ?? ""}
                        </span>
                      )}
                      <div className="mt-0.5 font-medium truncate">
                        {i.customer_name ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABEL[i.kind] ?? i.kind} ·{" "}
                        {new Date(i.issue_date).toLocaleDateString("es-ES")}
                      </div>
                      {i.corrected_by_reference && (
                        <div className="mt-0.5 text-[11px] text-amber-700">
                          ↳ rectificada por{" "}
                          <Link
                            href={`/facturas/${i.corrected_by_id}` as never}
                            className="font-bold hover:underline"
                          >
                            {i.corrected_by_reference}
                          </Link>
                        </div>
                      )}
                      {i.corrects_reference && (
                        <div className="mt-0.5 text-[11px] text-blue-700">
                          ↳ rectifica a{" "}
                          <Link
                            href={`/facturas/${i.corrects_invoice_id}` as never}
                            className="font-bold hover:underline"
                          >
                            {i.corrects_reference}
                          </Link>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="font-bold">{eur(i.total_cents)}</div>
                      {i.pending_cents > 0 ? (
                        <div className="text-[11px] font-semibold text-red-600">
                          Pdte. {eur(i.pending_cents)}
                        </div>
                      ) : (
                        <div className="text-[11px] text-emerald-600">Cobrada</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                    <StatusPill
                      label={STATUS_LABEL[i.status] ?? i.status}
                      tone={STATUS_TONE[i.status] ?? "info"}
                    />
                    <div className="flex items-center gap-0.5">
                      <InvoiceRowActions
                        invoiceId={i.id}
                        status={i.status}
                        pendingCents={i.pending_cents}
                        isCreditNote={i.kind === "credit_note"}
                        hasCreditNote={!!i.corrected_by_id}
                      />
                      <Link
                        href={`/facturas/${i.id}` as never}
                        title="Ver factura"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <a
                        href={`/api/pdf/invoice/${i.id}`}
                        target="_blank"
                        rel="noopener"
                        title="Descargar PDF"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Ref</th>
                    <th className="px-2 py-2 text-left">Tipo</th>
                    <th className="px-2 py-2 text-left">Cliente</th>
                    <th className="px-2 py-2 text-left">Emitida</th>
                    <th className="px-2 py-2 text-left">Vence</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-right">Pendiente</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-2 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleInvoices.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30">
                      <td className="px-2 py-2 font-mono text-xs">
                        <Link
                          href={`/facturas/${i.id}` as never}
                          className="text-primary hover:underline"
                        >
                          {i.full_reference}
                        </Link>
                        {i.is_maintenance_remesa && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800"
                            title={`Remesa mensual mantenimiento${i.billing_period ? ` · ${i.billing_period}` : ""}`}
                          >
                            REMESA
                            {i.billing_period && (
                              <span className="font-normal">
                                {" "}
                                {i.billing_period}
                              </span>
                            )}
                          </span>
                        )}
                        {i.corrected_by_reference && (
                          <div className="mt-0.5 text-[10px] text-amber-700">
                            ↳ rectificada por{" "}
                            <Link
                              href={`/facturas/${i.corrected_by_id}` as never}
                              className="font-bold hover:underline"
                            >
                              {i.corrected_by_reference}
                            </Link>
                          </div>
                        )}
                        {i.corrects_reference && (
                          <div className="mt-0.5 text-[10px] text-blue-700">
                            ↳ rectifica a{" "}
                            <Link
                              href={`/facturas/${i.corrects_invoice_id}` as never}
                              className="font-bold hover:underline"
                            >
                              {i.corrects_reference}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">{KIND_LABEL[i.kind] ?? i.kind}</td>
                      <td className="px-2 py-2">{i.customer_name ?? "—"}</td>
                      <td className="px-2 py-2 text-xs">
                        {new Date(i.issue_date).toLocaleDateString("es-ES")}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {i.due_date ? new Date(i.due_date).toLocaleDateString("es-ES") : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">
                        {eur(i.total_cents)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {i.pending_cents > 0 ? (
                          <span className="text-red-600 font-semibold">
                            {eur(i.pending_cents)}
                          </span>
                        ) : (
                          <span className="text-emerald-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          label={STATUS_LABEL[i.status] ?? i.status}
                          tone={STATUS_TONE[i.status] ?? "info"}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <InvoiceRowActions
                            invoiceId={i.id}
                            status={i.status}
                            pendingCents={i.pending_cents}
                            isCreditNote={i.kind === "credit_note"}
                            hasCreditNote={!!i.corrected_by_id}
                          />
                          <Link
                            href={`/facturas/${i.id}` as never}
                            title="Ver factura"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <a
                            href={`/api/pdf/invoice/${i.id}`}
                            target="_blank"
                            rel="noopener"
                            title="Descargar PDF"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          <Pagination
            basePath="/facturas"
            page={page}
            pageSize={PAGE_SIZE}
            hasMore={hasMore}
          />
        </CardContent>
      </Card>
    </div>
  );
}
