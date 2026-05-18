import Link from "next/link";
import { AlertTriangle, AlertOctagon, CalendarClock, CheckCircle2, Home } from "lucide-react";
import { getRentalsDashboard } from "@/modules/contracts/rentals-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const PAYMENT_STATE_LABEL: Record<string, string> = {
  pending: "Pendiente",
  paid_customer: "Pagado cliente",
  paid_financier: "Pagado financiera",
  reserve_pending: "Reserva pendiente",
};

const ALERT_META: Record<
  string,
  { label: string; tone: "destructive" | "warning" | "secondary" }
> = {
  overdue: { label: "Vencido", tone: "destructive" },
  expiring_soon: { label: "Vence pronto", tone: "warning" },
  unpaid: { label: "Impago", tone: "destructive" },
};

export default async function AlquileresPage() {
  const data = await getRentalsDashboard();
  const { rows, kpi } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Home className="h-6 w-6 text-primary" /> Cartera de alquileres
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Contratos de alquiler con remesa mensual, duración restante y
            mantenimientos asociados. Vista pensada para gestionar bajas,
            renovaciones e impagos.
          </p>
        </div>
        <Link
          href="/contratos"
          className="inline-flex h-10 items-center rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          ← Volver a contratos
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <KpiCard
          icon={<Home className="h-5 w-5" />}
          label="Activos"
          value={kpi.active_count}
          tone="primary"
        />
        <KpiCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="MRR alquiler"
          value={formatCents(kpi.mrr_cents)}
          tone="primary"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Vencen <3 meses"
          value={kpi.expiring_soon}
          tone={kpi.expiring_soon > 0 ? "warning" : "muted"}
        />
        <KpiCard
          icon={<AlertOctagon className="h-5 w-5" />}
          label="Impagos"
          value={kpi.unpaid}
          tone={kpi.unpaid > 0 ? "destructive" : "muted"}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Sin permanencia"
          value={kpi.permanence_done}
          tone="muted"
        />
      </div>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle>Contratos de alquiler ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay contratos de alquiler firmados.
            </p>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="space-y-2 md:hidden">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border bg-card p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {r.reference_code ?? "—"}
                        </div>
                        <Link
                          href={`/contratos/${r.id}` as never}
                          className="font-medium text-primary hover:underline truncate block"
                        >
                          {r.customer_name}
                        </Link>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatCents(r.monthly_cents)}/mes
                          {r.duration_months
                            ? ` · ${r.duration_months} meses`
                            : ""}
                        </div>
                      </div>
                      {r.alert && (
                        <Badge variant={ALERT_META[r.alert]!.tone}>
                          {ALERT_META[r.alert]!.label}
                        </Badge>
                      )}
                    </div>
                    {r.progress_pct != null && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{r.months_elapsed} meses</span>
                          <span>
                            {r.months_left} meses restantes
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${r.progress_pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-muted-foreground">Mant.: </span>
                        <span className="font-bold">{r.maintenance_done}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          / {r.maintenance_done + r.maintenance_pending}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Último cobro: </span>
                        <span className="font-bold">
                          {formatDate(r.last_payment_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: tabla */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Ref.</th>
                      <th className="px-3 py-2 text-left">Cliente</th>
                      <th className="px-3 py-2 text-right">Cuota/mes</th>
                      <th className="px-3 py-2 text-left">Inicio</th>
                      <th className="px-3 py-2 text-left">Fin previsto</th>
                      <th className="px-3 py-2 text-left">Progreso</th>
                      <th className="px-3 py-2 text-left">Cobro</th>
                      <th className="px-3 py-2 text-left">Mantenim.</th>
                      <th className="px-3 py-2 text-left">Alerta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link
                            href={`/contratos/${r.id}` as never}
                            className="text-primary hover:underline"
                          >
                            {r.reference_code ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.customer_name}</div>
                          {r.permanence_done && r.status === "active" && (
                            <div className="text-[10px] text-emerald-600">
                              Sin permanencia
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">
                          {formatCents(r.monthly_cents)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {formatDate(r.start_date)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {formatDate(r.end_date_est)}
                        </td>
                        <td className="px-3 py-2">
                          {r.progress_pct != null ? (
                            <div className="min-w-[120px]">
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>{r.months_elapsed}m</span>
                                <span>{r.months_left}m left</span>
                              </div>
                              <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${r.progress_pct}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div>
                            {r.last_payment_status ? (
                              <Badge
                                variant={
                                  r.last_payment_status === "validated"
                                    ? "success"
                                    : r.last_payment_status === "rejected"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {r.last_payment_status}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDate(r.last_payment_at)}
                          </div>
                          {r.payment_state && r.payment_state !== "pending" && (
                            <div className="text-[10px] text-muted-foreground">
                              {PAYMENT_STATE_LABEL[r.payment_state] ?? r.payment_state}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs tabular-nums">
                          <span className="font-bold">{r.maintenance_done}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            / {r.maintenance_done + r.maintenance_pending}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.alert ? (
                            <Badge variant={ALERT_META[r.alert]!.tone}>
                              {ALERT_META[r.alert]!.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "primary" | "warning" | "destructive" | "muted";
}) {
  const toneClasses = {
    primary: "bg-primary/5 text-primary border-primary/20",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    destructive: "bg-red-50 text-red-700 border-red-200",
    muted: "bg-muted/40 text-muted-foreground border-border",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${toneClasses}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
