import Link from "next/link";
import { getWalletSummary, listWalletEntries } from "@/modules/wallet/actions";
import { WALLET_STATUS_LABEL, METHOD_LABEL } from "@/modules/wallet/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KpiCard } from "@/shared/components/kpi-card";
import { StatusPill } from "@/shared/components/status-pill";
import { RegisterPaymentButton } from "@/modules/wallet/register-button";
import { ValidateWalletButtons } from "@/modules/wallet/validate-buttons";
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
  searchParams: Promise<{ method?: string; status?: string; from?: string; to?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const method = METHOD_OPTIONS.includes(sp.method as never) ? sp.method : undefined;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const fromDate = sp.from ? new Date(sp.from + "T00:00:00").toISOString() : undefined;
  const toDate = sp.to ? new Date(sp.to + "T23:59:59").toISOString() : undefined;
  const [entries, summary] = await Promise.all([
    listWalletEntries({ method, status, fromDate, toDate }),
    getWalletSummary(),
  ]);

  const canValidate =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Wallet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cobros y liquidaciones. Objetivo: dejar saldo a 0 tras liquidar.
          </p>
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
          label="Pendiente"
          value={formatCents(summary.pending_cents)}
          icon="Clock"
          iconColor="warning"
        />
        <KpiCard
          label="Cobrado"
          value={formatCents(summary.collected_cents)}
          icon="Coins"
          iconColor="primary"
        />
        <KpiCard
          label="Pdte. liquidar"
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
          label="Validado"
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
        {(method || status || sp.from || sp.to) && (
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
                    <th className="py-3 text-left">Fecha</th>
                    <th className="py-3 text-left">Concepto</th>
                    <th className="py-3 text-right">Importe</th>
                    <th className="py-3 text-left">Método</th>
                    <th className="py-3 text-left">Estado</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="py-3 text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleDateString("es-ES")}
                      </td>
                      <td className="py-3 font-medium">{e.concept}</td>
                      <td className="py-3 text-right font-semibold tabular-nums">
                        {formatCents(e.amount_cents)}
                      </td>
                      <td className="py-3">
                        <Badge variant="outline">{METHOD_LABEL[e.method] ?? e.method}</Badge>
                      </td>
                      <td className="py-3">
                        <StatusPill
                          label={WALLET_STATUS_LABEL[e.status] ?? e.status}
                          tone={WALLET_TONE[e.status] ?? "info"}
                        />
                      </td>
                      <td className="py-3 text-right">
                        <ValidateWalletButtons
                          id={e.id}
                          status={e.status}
                          method={e.method}
                          canValidate={canValidate}
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
