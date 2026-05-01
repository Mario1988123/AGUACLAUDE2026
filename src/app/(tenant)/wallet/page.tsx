import { getWalletSummary, listWalletEntries } from "@/modules/wallet/actions";
import { WALLET_STATUS_LABEL, METHOD_LABEL } from "@/modules/wallet/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

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
  const [entries, summary] = await Promise.all([listWalletEntries(), getWalletSummary()]);

  const cards: Array<{ label: string; value: number; variant?: "warning" | "success" }> = [
    { label: "Pendiente", value: summary.pending_cents, variant: "warning" },
    { label: "Cobrado", value: summary.collected_cents },
    { label: "Pdte. liquidar", value: summary.pending_settlement_cents, variant: "warning" },
    { label: "Liquidado", value: summary.settled_cents },
    { label: "Validado", value: summary.validated_cents, variant: "success" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground">
          Cobros y liquidaciones. Objetivo: dejar saldo a 0 tras liquidar.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-lg border bg-card p-4 ${c.variant === "warning" ? "border-warning" : c.variant === "success" ? "border-success" : ""}`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{formatCents(c.value)}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay movimientos.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Fecha</th>
                  <th className="py-2 text-left">Concepto</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-left">Método</th>
                  <th className="py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString("es-ES")}
                    </td>
                    <td className="py-2">{e.concept}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(e.amount_cents)}</td>
                    <td className="py-2 text-xs">{METHOD_LABEL[e.method] ?? e.method}</td>
                    <td className="py-2">
                      <Badge variant={STATUS_VARIANT[e.status] ?? "default"}>
                        {WALLET_STATUS_LABEL[e.status] ?? e.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
