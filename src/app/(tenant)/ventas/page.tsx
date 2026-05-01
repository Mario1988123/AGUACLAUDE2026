import { listObjectives, listSales } from "@/modules/sales/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

export default async function VentasPage() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const [sales, objectives] = await Promise.all([listSales(y, m), listObjectives(y, m)]);

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
          <CardTitle>Objetivos del mes</CardTitle>
        </CardHeader>
        <CardContent>
          {objectives.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay objetivos definidos para este mes. Decisión D: nivel 1 fija meta de
              departamento, nivel 2 distribuye entre su equipo nivel 3.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Alcance</th>
                  <th className="py-2 text-left">Métrica</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-right">Unidades</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {objectives.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2">
                      {o.scope_type === "department" ? (
                        <Badge variant="outline">
                          Dpto: {DEPT_LABEL[o.scope_department!] ?? o.scope_department}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Usuario</Badge>
                      )}
                    </td>
                    <td className="py-2 text-xs">{o.metric_kind}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCents(o.target_amount_cents)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{o.target_units ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
