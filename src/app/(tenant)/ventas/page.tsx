import { listSales } from "@/modules/sales/actions";
import { listObjectivesAchievement } from "@/modules/sales/achievement-actions";
import { ObjectivesAchievementList } from "@/modules/sales/achievement-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

export default async function VentasPage() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const [sales, achievements] = await Promise.all([
    listSales(y, m),
    listObjectivesAchievement(y, m),
  ]);

  const totalMonth = sales.reduce((s, x) => s + x.total_cents, 0);
  const monthlyMonth = sales.reduce((s, x) => s + (x.monthly_cents ?? 0), 0);
  const financierMonth = sales.reduce((s, x) => s + (x.financier_payment_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ventas y objetivos</h1>
        <p className="text-sm text-muted-foreground">
          Período {String(m).padStart(2, "0")}/{y} · {sales.length} registros
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Total vendido (mes)" value={formatCents(totalMonth)} />
        <KpiCard label="Cuotas mensuales" value={formatCents(monthlyMonth)} />
        <KpiCard label="Financieras pagan" value={formatCents(financierMonth)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cumplimiento objetivos del mes</CardTitle>
        </CardHeader>
        <CardContent>
          <ObjectivesAchievementList data={achievements} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registros del mes</CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas registradas este mes.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Fecha</th>
                  <th className="py-2 text-left">Plan</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Cuota</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(s.recorded_at).toLocaleDateString("es-ES")}
                    </td>
                    <td className="py-2 text-xs">{PLAN_LABEL[s.plan_type] ?? s.plan_type}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(s.total_cents)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(s.monthly_cents)}</td>
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

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
