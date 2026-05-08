import Link from "next/link";
import { getWalletSummary, listWalletEntries } from "@/modules/wallet/actions";
import { WALLET_STATUS_LABEL, METHOD_LABEL } from "@/modules/wallet/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KpiCard } from "@/shared/components/kpi-card";
import { StatusPill } from "@/shared/components/status-pill";
import { RegisterPaymentButton } from "@/modules/wallet/register-button";
import { ValidateWalletButtons } from "@/modules/wallet/validate-buttons";
import { PaymentMethodBadge } from "@/modules/wallet/payment-method-badge";
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
  }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const method = METHOD_OPTIONS.includes(sp.method as never) ? sp.method : undefined;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const fromDate = sp.from ? new Date(sp.from + "T00:00:00").toISOString() : undefined;
  const toDate = sp.to ? new Date(sp.to + "T23:59:59").toISOString() : undefined;
  const notInvoiced = sp.invoice === "pending";
  const [entries, summary] = await Promise.all([
    listWalletEntries({ method, status, fromDate, toDate, notInvoiced }),
    getWalletSummary(),
  ]);

  const canValidate =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const canInvoice = session.is_superadmin || session.roles.includes("company_admin");
  const isAdmin = canInvoice;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight">Wallet</h1>
          <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="font-bold text-amber-700">Sin cobrar</span> — el cliente todavía no
              ha pagado.
            </div>
            <div>
              <span className="font-bold text-blue-700">Cobrado · pdte. banco</span> — comercial tiene
              justificante (datáfono, transferencia…), pero el admin todavía no ha visto el dinero
              en banco.
            </div>
            <div>
              <span className="font-bold text-orange-700">Cobrado · pdte. liquidar</span> — efectivo
              en mano del comercial; falta entregar a la empresa.
            </div>
            <div>
              <span className="font-bold text-emerald-700">Confirmado en banco</span> — admin ha
              verificado el ingreso. Estado final.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/api/export/wallet" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar CSV
          </Link>
          <RegisterPaymentButton />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Sin cobrar"
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
          label="Liquidado"
          value={formatCents(summary.settled_cents)}
          icon="Banknote"
          iconColor="primary"
        />
        <KpiCard
          label="Confirmado en banco"
          value={formatCents(summary.validated_cents)}
          icon="CheckCircle2"
          iconColor="success"
        />
      </div>

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
          <CardTitle>Movimientos ({entries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay movimientos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-3 pr-4 text-left">Fecha</th>
                    <th className="py-3 pr-4 text-left">Cliente</th>
                    <th className="py-3 pr-4 text-left">Contrato</th>
                    <th className="py-3 pr-4 text-left">Concepto</th>
                    <th className="py-3 pr-6 text-right">Importe</th>
                    <th className="py-3 pr-4 text-left">Método</th>
                    <th className="py-3 pr-4 text-left">Estado</th>
                    {isAdmin && <th className="py-3 pr-4 text-left">Comercial</th>}
                    <th className="py-3 pr-4 text-left">Factura</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="py-3 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.created_at).toLocaleDateString("es-ES")}
                      </td>
                      <td className="py-3 pr-4">
                        {e.customer_id ? (
                          <Link
                            href={`/clientes/${e.customer_id}` as never}
                            className="font-medium hover:underline"
                          >
                            {e.customer_name ?? "Cliente"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs">
                        {e.contract_id && e.contract_reference ? (
                          <Link
                            href={`/contratos/${e.contract_id}` as never}
                            className="font-mono text-primary hover:underline"
                          >
                            {e.contract_reference}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs">{e.concept}</td>
                      <td className="py-3 pr-6 text-right font-semibold tabular-nums whitespace-nowrap">
                        {formatCents(e.amount_cents)}
                      </td>
                      <td className="py-3 pr-4">
                        <PaymentMethodBadge method={e.method} />
                      </td>
                      <td className="py-3 pr-4">
                        <StatusPill
                          label={WALLET_STATUS_LABEL[e.status] ?? e.status}
                          tone={WALLET_TONE[e.status] ?? "info"}
                        />
                      </td>
                      {isAdmin && (
                        <td className="py-3 pr-4 text-xs">
                          {e.collected_by_name ? (
                            <span className="font-medium">{e.collected_by_name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 pr-4 text-xs">
                        {e.invoice_id ? (
                          <Link
                            href={`/facturas/${e.invoice_id}` as never}
                            className="text-primary hover:underline"
                          >
                            ✓ {e.invoice_reference ?? "Facturada"}
                          </Link>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Sin facturar
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 text-right">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
