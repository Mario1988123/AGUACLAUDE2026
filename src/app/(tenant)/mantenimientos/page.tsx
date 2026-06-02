import Link from "next/link";
import { Eye } from "lucide-react";
import { listMaintenance } from "@/modules/maintenance/actions";
import { STATUS_LABEL } from "@/modules/maintenance/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { listMaintenanceContracts } from "@/modules/maintenance-plans/actions";
import {
  MaintenanceContractsTable,
  MaintenanceRemesaButton,
} from "@/modules/maintenance-plans/contracts-table";
import { PreprogrammedPanel } from "@/modules/maintenance/preprogrammed-panel";
import { requireSession } from "@/shared/lib/auth/session";
import { requireModuleAccess } from "@/shared/lib/auth/module-guard";
import {
  MaintenanceSmartAlerts,
  getMaintenanceAlerts,
} from "@/modules/maintenance/smart-alerts";
import { listInstallers } from "@/modules/agenda/actions";

export const dynamic = "force-dynamic";

const MAINT_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  preprogrammed: "onhold",
  needs_callback: "rejected",
  scheduled: "info",
  in_progress: "processing",
  completed: "success",
  cancelled: "rejected",
  rescheduled: "neutral",
};

const STATUS_OPTIONS = ["preprogrammed", "scheduled", "in_progress", "completed", "cancelled"] as const;
const PERIOD_OPTIONS = {
  "": "Todas las fechas",
  upcoming: "Próximas",
  this_month: "Este mes",
  past: "Anteriores",
} as const;

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function periodToRange(period: string): { fromDate?: string; toDate?: string } {
  const now = new Date();
  if (period === "upcoming") return { fromDate: now.toISOString() };
  if (period === "past") return { toDate: now.toISOString() };
  if (period === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    return { fromDate: start, toDate: end };
  }
  return {};
}

export default async function MantenimientosPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    period?: string;
    technician?: string;
    kind?: string;
  }>;
}) {
  const session = await requireSession();
  requireModuleAccess(session, [
    "company_admin",
    "technical_director",
    "installer",
  ]);

  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  const sp = await searchParams;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const period = sp.period && Object.prototype.hasOwnProperty.call(PERIOD_OPTIONS, sp.period) ? sp.period : "";
  const technicianFilter = sp.technician || undefined;
  const kindFilter =
    sp.kind === "contracted" || sp.kind === "one_off" || sp.kind === "warranty"
      ? sp.kind
      : undefined;
  const { fromDate, toDate } = periodToRange(period);
  const [allJobs, contracts, alerts, technicians] = await Promise.all([
    listMaintenance({ status, fromDate, toDate }),
    listMaintenanceContracts().catch(() => []),
    isUpper
      ? getMaintenanceAlerts().catch(() => null)
      : Promise.resolve(null),
    listInstallers().catch(() => []),
  ]);
  // Filtros adicionales en cliente (no rompemos la signatura existente de listMaintenance).
  const jobs = allJobs.filter((j) => {
    if (technicianFilter === "unassigned" && j.technician_user_id) return false;
    if (technicianFilter && technicianFilter !== "unassigned" && j.technician_user_id !== technicianFilter) {
      return false;
    }
    if (kindFilter && j.kind !== kindFilter) return false;
    return true;
  });
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");

  // KPIs cabecera
  const completedThisMonth = jobs.filter((j) => {
    if (j.status !== "completed" || !j.completed_at) return false;
    const d = new Date(j.completed_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const scheduledNext7 = jobs.filter((j) => {
    if (j.status !== "scheduled" || !j.scheduled_at) return false;
    const d = new Date(j.scheduled_at).getTime();
    const now = Date.now();
    return d >= now && d <= now + 7 * 86400000;
  }).length;
  const totalChargedThisMonth = jobs.reduce((s, j) => {
    if (
      j.status === "completed" &&
      j.is_charged &&
      j.completed_at &&
      new Date(j.completed_at).getMonth() === new Date().getMonth()
    ) {
      return s + (j.charge_cents ?? 0);
    }
    return s;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Mantenimientos</h1>
          <p className="text-sm text-muted-foreground">
            {contracts.length} contratos · {jobs.length} trabajos
          </p>
        </div>
        {isUpper && (
          <Link
            href="/mantenimientos/por-confirmar"
            className="inline-flex h-10 items-center gap-2 rounded-xl border-2 border-primary bg-primary/5 px-4 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            Por confirmar →
          </Link>
        )}
      </div>

      {isUpper && alerts && <MaintenanceSmartAlerts alerts={alerts} />}

      {/* Visitas preprogramadas pendientes de validar (decisión 2026-05-19) */}
      {isUpper && (
        <PreprogrammedPanel
          jobs={allJobs
            .filter((j) => j.status === "preprogrammed")
            .map((j) => ({
              id: j.id,
              scheduled_at: j.scheduled_at,
              customer_id: j.customer_id,
              customer_name: j.customer_name,
              technician_user_id: j.technician_user_id,
            }))}
          installers={technicians}
        />
      )}

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Completados este mes</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums">{completedThisMonth}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Próximos 7 días</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums">{scheduledNext7}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Cobrado este mes</div>
          <div className="mt-1 text-3xl font-extrabold tabular-nums">
            {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(totalChargedThisMonth / 100)}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span>Contratos de mantenimiento ({contracts.length})</span>
            {isAdmin && <MaintenanceRemesaButton />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MaintenanceContractsTable contracts={contracts} />
        </CardContent>
      </Card>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
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
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Período</label>
          <select
            name="period"
            defaultValue={period}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            {Object.entries(PERIOD_OPTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Técnico</label>
          <select
            name="technician"
            defaultValue={technicianFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="unassigned">— Sin asignar —</option>
            {technicians.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Tipo</label>
          <select
            name="kind"
            defaultValue={kindFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            <option value="contracted">Contratado</option>
            <option value="one_off">Puntual</option>
            <option value="warranty">Garantía</option>
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(status || period || technicianFilter || kindFilter) && (
          <Link href="/mantenimientos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin mantenimientos con esos filtros.</p>
          ) : (
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {jobs.map((j) => (
                <li key={j.id} className="rounded-xl border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/mantenimientos/${j.id}`} className="font-medium text-primary hover:underline truncate">
                          {j.customer_name ?? "—"}
                        </Link>
                        {j.alerts && j.alerts.length > 0 && (
                          <span
                            className="inline-flex h-5 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800"
                            title={j.alerts.join(" · ")}
                          >
                            ⚠ {j.alerts.length}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString("es-ES") : "—"}
                      </div>
                    </div>
                    <StatusPill
                      label={STATUS_LABEL[j.status] ?? j.status}
                      tone={MAINT_TONE[j.status] ?? "info"}
                    />
                  </div>
                  <div className="mt-1 text-xs">
                    {j.technician_name ? (
                      <span className="text-muted-foreground">
                        Técnico: <strong>{j.technician_name}</strong>
                      </span>
                    ) : (
                      <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-800">
                        Por asignar
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                    <span className="text-xs tabular-nums">
                      {j.is_charged ? (
                        <strong>{formatCents(j.charge_cents)}</strong>
                      ) : (
                        <span className="text-muted-foreground">Incluido</span>
                      )}
                    </span>
                    <Link
                      href={`/mantenimientos/${j.id}` as never}
                      title="Ver mantenimiento"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabla */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Cliente</th>
                  <th className="py-2 text-left">Programado</th>
                  <th className="py-2 text-left">Técnico</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-muted/50">
                    <td className="py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/mantenimientos/${j.id}`} className="text-primary hover:underline">
                          {j.customer_name ?? "—"}
                        </Link>
                        {j.alerts && j.alerts.length > 0 && (
                          <span
                            className="inline-flex h-5 items-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-800"
                            title={j.alerts.join(" · ")}
                          >
                            ⚠ {j.alerts.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString("es-ES") : "—"}
                    </td>
                    <td className="py-2">
                      {j.technician_name ? (
                        <span className="text-sm">{j.technician_name}</span>
                      ) : (
                        <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                          Por asignar
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <StatusPill
                        label={STATUS_LABEL[j.status] ?? j.status}
                        tone={MAINT_TONE[j.status] ?? "info"}
                      />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {j.is_charged ? formatCents(j.charge_cents) : <span className="text-xs text-muted-foreground">Incluido</span>}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/mantenimientos/${j.id}` as never}
                        title="Ver mantenimiento"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
