import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { getSlaStats } from "@/modules/incidents/sla-stats-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export default async function SlaDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");

  const sp = await searchParams;
  const now = new Date();
  const y = Number(sp.year) || now.getFullYear();
  const m = Number(sp.month) || now.getMonth() + 1;
  const stats = await getSlaStats(y, m);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Cumplimiento SLA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          % de incidencias resueltas dentro de plazo. Solo admin y directores.
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
          Ver
        </button>
      </form>

      {!stats ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No hay datos disponibles para este periodo.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <KpiCard label="Total" value={String(stats.total)} />
            <KpiCard
              label="A tiempo"
              value={String(stats.on_time)}
              tone="success"
            />
            <KpiCard label="Fuera de plazo" value={String(stats.late)} tone="error" />
            <KpiCard
              label="Cumplimiento"
              value={`${stats.compliance_pct}%`}
              tone={stats.compliance_pct >= 90 ? "success" : stats.compliance_pct >= 75 ? "warning" : "error"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por prioridad</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Prioridad</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">A tiempo</th>
                    <th className="py-2 text-right">Tarde</th>
                    <th className="py-2 text-right">Pendientes</th>
                    <th className="py-2 text-right">% cumplimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(Object.entries(stats.by_priority) as Array<[string, typeof stats.by_priority[string]]>).map(([p, b]) => {
                    const closed = b.on_time + b.late;
                    const pct = closed > 0 ? Math.round((b.on_time / closed) * 100) : 100;
                    return (
                      <tr key={p}>
                        <td className="py-2">
                          <Badge variant={p === "critical" ? "destructive" : p === "high" ? "warning" : p === "medium" ? "secondary" : "outline"}>
                            {PRIORITY_LABEL[p] ?? p}
                          </Badge>
                        </td>
                        <td className="py-2 text-right tabular-nums">{b.total}</td>
                        <td className="py-2 text-right tabular-nums text-emerald-700">{b.on_time}</td>
                        <td className="py-2 text-right tabular-nums text-rose-700">{b.late}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{b.pending}</td>
                        <td className="py-2 text-right tabular-nums font-bold">
                          {b.total === 0 ? "—" : `${pct}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por técnico</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.by_technician.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin incidencias asignadas en el periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 text-left">Técnico</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">A tiempo</th>
                      <th className="py-2 text-right">Tarde</th>
                      <th className="py-2 text-right">% cumplimiento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {stats.by_technician.map((t) => (
                      <tr key={t.user_id}>
                        <td className="py-2 font-bold">{t.user_name}</td>
                        <td className="py-2 text-right tabular-nums">{t.total}</td>
                        <td className="py-2 text-right tabular-nums text-emerald-700">{t.on_time}</td>
                        <td className="py-2 text-right tabular-nums text-rose-700">{t.late}</td>
                        <td className="py-2 text-right tabular-nums font-bold">{t.compliance_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Link href="/incidencias" className="text-xs text-muted-foreground hover:underline">
        ← Volver a incidencias
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "error";
}) {
  const colorMap = {
    success: "text-emerald-700 bg-emerald-50",
    warning: "text-amber-700 bg-amber-50",
    error: "text-rose-700 bg-rose-50",
  };
  const cls = tone ? colorMap[tone] : "text-foreground bg-card";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
