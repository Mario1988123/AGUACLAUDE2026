import Link from "next/link";
import { getWalletSummary, getWalletYearlyHistory, listWalletEntries } from "@/modules/wallet/actions";
import { WALLET_STATUS_LABEL, METHOD_LABEL } from "@/modules/wallet/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KpiCard } from "@/shared/components/kpi-card";
import { StatusPill } from "@/shared/components/status-pill";
import { RegisterPaymentButton } from "@/modules/wallet/register-button";
import { ValidateWalletButtons } from "@/modules/wallet/validate-buttons";
import { PaymentMethodBadge } from "@/modules/wallet/payment-method-badge";
import { WalletInfoButton } from "@/modules/wallet/info-modal";
import { WalletSmartAlerts, getWalletAlerts } from "@/modules/wallet/smart-alerts";
import { Pagination } from "@/shared/components/pagination";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const WALLET_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  pending: "onhold",
  collected: "processing",
  pending_settlement: "onhold",
  settled: "neutral",
  validated: "success",
  rejected: "rejected",
};

const METHOD_OPTIONS = ["cash", "card", "bizum", "transfer", "direct_debit", "financing"] as const;
const STATUS_OPTIONS = [
  "pending",
  "collected",
  "pending_settlement",
  "settled",
  "validated",
  "rejected",
] as const;

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    method?: string;
    status?: string;
    from?: string;
    to?: string;
    invoice?: string;
    period_year?: string;
    period_month?: string;
    history_year?: string;
    page?: string;
  }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const method = METHOD_OPTIONS.includes(sp.method as never) ? sp.method : undefined;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const fromDate = sp.from ? new Date(sp.from + "T00:00:00").toISOString() : undefined;
  const toDate = sp.to ? new Date(sp.to + "T23:59:59").toISOString() : undefined;
  const notInvoiced = sp.invoice === "pending";
  const now = new Date();
  const periodYear = sp.period_year ? parseInt(sp.period_year, 10) : now.getFullYear();
  const periodMonth = sp.period_month ? parseInt(sp.period_month, 10) : now.getMonth() + 1;
  const historyYear = sp.history_year ? parseInt(sp.history_year, 10) : now.getFullYear();
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const canValidate =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const canInvoice = session.is_superadmin || session.roles.includes("company_admin");
  const isAdmin = canInvoice;
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  const [entries, summary, yearHistory, walletAlerts] = await Promise.all([
    listWalletEntries({
      method,
      status,
      fromDate,
      toDate,
      notInvoiced,
      limit: PAGE_SIZE + 1,
      offset,
    }),
    getWalletSummary({ year: periodYear, month: periodMonth }),
    isAdmin ? getWalletYearlyHistory({ year: historyYear }) : Promise.resolve([]),
    isUpper ? getWalletAlerts().catch(() => null) : Promise.resolve(null),
  ]);

  const MONTHS = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const yearsAvailable: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) yearsAvailable.push(y);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Wallet</h1>
          <WalletInfoButton />
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <Link
            href={"/wallet/financieras" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            🏦 Pagos financieras
          </Link>
          <Link
            href={"/api/export/wallet" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ CSV
          </Link>
          {(session.is_superadmin ||
            session.roles.includes("company_admin")) && (
            <a
              href="/api/sepa/remesa-xml"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
              title="Genera un archivo XML SEPA pain.008 con los cobros pendientes por domiciliación, listo para subir al banco"
            >
              🏛 Remesa SEPA
            </a>
          )}
          <RegisterPaymentButton />
        </div>
      </div>

      <div className="sm:hidden flex gap-2">
        <RegisterPaymentButton />
        <Link
          href={"/api/export/wallet" as never}
          prefetch={false}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ⬇ CSV
        </Link>
      </div>

      {isUpper && walletAlerts && <WalletSmartAlerts alerts={walletAlerts} />}

      <div className="space-y-3">
        <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Mes del resumen</label>
            <div className="flex gap-2">
              <select
                name="period_month"
                defaultValue={String(periodMonth)}
                className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                name="period_year"
                defaultValue={String(periodYear)}
                className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
              >
                {yearsAvailable.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              {/* Mantener filtros activos */}
              {method && <input type="hidden" name="method" value={method} />}
              {status && <input type="hidden" name="status" value={status} />}
              {sp.from && <input type="hidden" name="from" value={sp.from} />}
              {sp.to && <input type="hidden" name="to" value={sp.to} />}
              {sp.invoice && <input type="hidden" name="invoice" value={sp.invoice} />}
              {sp.history_year && (
                <input type="hidden" name="history_year" value={sp.history_year} />
              )}
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Aplicar
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground self-center">
            Pendientes son acumulados. Liquidado y Confirmado en banco son del mes seleccionado.
          </p>
        </form>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Sin cobrar (acumulado)"
            value={formatCents(summary.pending_cents)}
            icon="Clock"
            iconColor="warning"
          />
          <KpiCard
            label="Cobrado · pdte. banco"
            value={formatCents(summary.collected_cents)}
            icon="Coins"
            iconColor="primary"
          />
          <KpiCard
            label="Pdte. liquidar (efectivo)"
            value={formatCents(summary.pending_settlement_cents)}
            icon="HandCoins"
            iconColor="warning"
          />
          <KpiCard
            label={`Liquidado · ${MONTHS[periodMonth - 1]} ${periodYear}`}
            value={formatCents(summary.settled_month_cents)}
            icon="Banknote"
            iconColor="primary"
          />
          <KpiCard
            label={`Confirmado banco · ${MONTHS[periodMonth - 1]} ${periodYear}`}
            value={formatCents(summary.validated_month_cents)}
            icon="CheckCircle2"
            iconColor="success"
          />
        </div>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3">
              <span>Histórico mensual {historyYear}</span>
              <form className="flex gap-2">
                <select
                  name="history_year"
                  defaultValue={String(historyYear)}
                  className="h-8 rounded-xl border border-input bg-background px-3 text-xs"
                >
                  {yearsAvailable.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                {/* preserve other params */}
                {method && <input type="hidden" name="method" value={method} />}
                {status && <input type="hidden" name="status" value={status} />}
                {sp.from && <input type="hidden" name="from" value={sp.from} />}
                {sp.to && <input type="hidden" name="to" value={sp.to} />}
                {sp.invoice && <input type="hidden" name="invoice" value={sp.invoice} />}
                <input type="hidden" name="period_year" value={String(periodYear)} />
                <input type="hidden" name="period_month" value={String(periodMonth)} />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
                >
                  Ver año
                </button>
              </form>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left">Mes</th>
                    <th className="py-2 text-right">Liquidado (efectivo)</th>
                    <th className="py-2 text-right">Confirmado banco</th>
                    <th className="py-2 text-right">Total cerrado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {yearHistory.map((m) => {
                    const isCurrent =
                      historyYear === now.getFullYear() && m.month === now.getMonth() + 1;
                    const isFuture =
                      historyYear > now.getFullYear() ||
                      (historyYear === now.getFullYear() && m.month > now.getMonth() + 1);
                    return (
                      <tr
                        key={m.month}
                        className={`hover:bg-muted/30 ${isFuture ? "opacity-40" : ""} ${isCurrent ? "bg-primary/5 font-semibold" : ""}`}
                      >
                        <td className="py-2">
                          {MONTHS[m.month - 1]}
                          {isCurrent && (
                            <span className="ml-2 text-xs text-primary">(actual)</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCents(m.settled_cents)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCents(m.validated_cents)}
                        </td>
                        <td className="py-2 text-right font-bold tabular-nums">
                          {formatCents(m.total_final_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t font-bold">
                    <td className="py-3 text-left">Total {historyYear}</td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(yearHistory.reduce((s, m) => s + m.settled_cents, 0))}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(yearHistory.reduce((s, m) => s + m.validated_cents, 0))}
                    </td>
                    <td className="py-3 text-right text-lg tabular-nums">
                      {formatCents(yearHistory.reduce((s, m) => s + m.total_final_cents, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Método</label>
          <select
            name="method"
            defaultValue={method ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {METHOD_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Estado</label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {WALLET_STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Facturación</label>
            <select
              name="invoice"
              defaultValue={sp.invoice ?? ""}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Todas</option>
              <option value="pending">Sin facturar</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Desde</label>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Hasta</label>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(method || status || sp.from || sp.to || sp.invoice) && (
          <Link href="/wallet" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos (página {page})</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay movimientos.</p>
          ) : (
            <>
              {/* MÓVIL: cards apiladas */}
              <div className="space-y-3 lg:hidden">
                {entries.slice(0, PAGE_SIZE).map((e) => (
                  <div
                    key={e.id}
                    className="rounded-xl border border-border bg-card/50 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {e.customer_id ? (
                          <Link
                            href={`/clientes/${e.customer_id}` as never}
                            className="font-bold text-sm hover:underline block truncate"
                          >
                            {e.customer_name ?? "Cliente"}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin cliente</span>
                        )}
                        <div className="text-xs text-muted-foreground truncate">{e.concept}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold tabular-nums">{formatCents(e.amount_cents)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(e.created_at).toLocaleDateString("es-ES")}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PaymentMethodBadge method={e.method} />
                      <StatusPill
                        label={WALLET_STATUS_LABEL[e.status] ?? e.status}
                        tone={WALLET_TONE[e.status] ?? "info"}
                      />
                      {e.contract_reference && (
                        <Link
                          href={`/contratos/${e.contract_id}` as never}
                          className="text-[11px] font-mono text-primary hover:underline"
                        >
                          {e.contract_reference}
                        </Link>
                      )}
                      {e.invoice_id && (
                        <Link
                          href={`/facturas/${e.invoice_id}` as never}
                          className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:underline"
                        >
                          ✓ Factura
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                      {isAdmin && (
                        <span className="text-[11px] text-muted-foreground truncate flex-1">
                          {e.collected_by_name ?? "—"}
                        </span>
                      )}
                      <ValidateWalletButtons
                        id={e.id}
                        status={e.status}
                        method={e.method}
                        canValidate={canValidate}
                        needsInvoice={!e.invoice_id && !!e.customer_id}
                        canInvoice={canInvoice}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* DESKTOP: tabla compacta */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 text-left">Fecha</th>
                      <th className="py-2 pr-3 text-left">Cliente</th>
                      <th className="py-2 pr-3 text-left">Contrato</th>
                      <th className="py-2 pr-3 text-left">Concepto</th>
                      <th className="py-2 pr-4 text-right">Importe</th>
                      <th className="py-2 pr-3 text-left">Método</th>
                      <th className="py-2 pr-3 text-left">Estado</th>
                      {isAdmin && <th className="py-2 pr-3 text-left">Comercial</th>}
                      <th className="py-2 pr-3 text-center">Fact.</th>
                      <th className="py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.slice(0, PAGE_SIZE).map((e) => (
                      <tr key={e.id} className="hover:bg-muted/30">
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(e.created_at).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="py-2 pr-3 max-w-[180px]">
                          {e.customer_id ? (
                            <Link
                              href={`/clientes/${e.customer_id}` as never}
                              className="font-medium text-sm hover:underline block truncate"
                              title={e.customer_name ?? ""}
                            >
                              {e.customer_name ?? "Cliente"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {e.contract_id && e.contract_reference ? (
                            <Link
                              href={`/contratos/${e.contract_id}` as never}
                              className="font-mono text-primary hover:underline whitespace-nowrap"
                            >
                              {e.contract_reference}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs max-w-[160px] truncate" title={e.concept}>
                          {e.concept}
                        </td>
                        <td className="py-2 pr-4 text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatCents(e.amount_cents)}
                        </td>
                        <td className="py-2 pr-3">
                          <PaymentMethodBadge method={e.method} />
                        </td>
                        <td className="py-2 pr-3">
                          <StatusPill
                            label={WALLET_STATUS_LABEL[e.status] ?? e.status}
                            tone={WALLET_TONE[e.status] ?? "info"}
                          />
                        </td>
                        {isAdmin && (
                          <td className="py-2 pr-3 text-xs max-w-[120px] truncate">
                            {e.collected_by_name ? (
                              <span className="font-medium">{e.collected_by_name}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                        <td className="py-2 pr-3 text-center">
                          {e.invoice_id ? (
                            <Link
                              href={`/facturas/${e.invoice_id}` as never}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              title={e.invoice_reference ?? "Facturada"}
                            >
                              ✓
                            </Link>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <ValidateWalletButtons
                            id={e.id}
                            status={e.status}
                            method={e.method}
                            canValidate={canValidate}
                            needsInvoice={!e.invoice_id && !!e.customer_id}
                            canInvoice={canInvoice}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Pagination
            basePath="/wallet"
            page={page}
            pageSize={PAGE_SIZE}
            hasMore={entries.length > PAGE_SIZE}
            preserveParams={{
              method,
              status,
              from: sp.from,
              to: sp.to,
              invoice: sp.invoice,
              period_year: sp.period_year,
              period_month: sp.period_month,
              history_year: sp.history_year,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
