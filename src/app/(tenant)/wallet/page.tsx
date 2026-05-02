import Link from "next/link";
import { getWalletSummary, listWalletEntries } from "@/modules/wallet/actions";
import { WALLET_STATUS_LABEL, METHOD_LABEL } from "@/modules/wallet/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KpiCard } from "@/shared/components/kpi-card";
import { RegisterPaymentButton } from "@/modules/wallet/register-button";
import { ValidateWalletButtons } from "@/modules/wallet/validate-buttons";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  pending: "warning",
  collected: "default",
  pending_settlement: "warning",
  settled: "secondary",
  validated: "success",
  rejected: "destructive",
};

export default async function WalletPage() {
  const session = await requireSession();
  const [entries, summary] = await Promise.all([listWalletEntries(), getWalletSummary()]);

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
                        <Badge variant={STATUS_VARIANT[e.status] ?? "default"}>
                          {WALLET_STATUS_LABEL[e.status] ?? e.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        {(e.status === "collected" || e.status === "pending_settlement") && (
                          <ValidateWalletButtons id={e.id} canValidate={canValidate} />
                        )}
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
