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

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const y = Number(sp.year) || now.getFullYear();
  const m = Number(sp.month) || now.getMonth() + 1;

  const [sales, achievements] = await Promise.all([
    listSales(y, m),
    listObjectivesAchievement(y, m),
  ]);

  const totalMonth = sales.reduce((s, x) => s + x.total_cents, 0);
  const monthlyMonth = sales.reduce((s, x) => s + (x.monthly_cents ?? 0), 0);
  const financierMonth = sales.reduce((s, x) => s + (x.financier_payment_cents ?? 0), 0);

  // Build options: current year and 4 previous
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ventas y objetivos</h1>
        <p className="text-sm text-muted-foreground">
          Período {String(m).padStart(2, "0")}/{y} · {sales.length} registros
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Mes</label>
          <select
            name="month"
            defaultValue={String(m)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={String(idx + 1)}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Año</label>
          <select
            name="year"
            defaultValue={String(y)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {years.map((yr) => (
              <option key={yr} value={String(yr)}>
                {yr}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Ver período
        </button>
      </form>

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
