import Link from "next/link";
import { listMaintenance } from "@/modules/maintenance/actions";
import { STATUS_LABEL } from "@/modules/maintenance/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { listMaintenanceContracts } from "@/modules/maintenance-plans/actions";
import {
  MaintenanceContractsTable,
  MaintenanceRemesaButton,
} from "@/modules/maintenance-plans/contracts-table";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const MAINT_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  scheduled: "info",
  in_progress: "onhold",
  completed: "success",
  cancelled: "rejected",
};

const STATUS_OPTIONS = ["scheduled", "in_progress", "completed", "cancelled"] as const;
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
  searchParams: Promise<{ status?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const period = sp.period && Object.prototype.hasOwnProperty.call(PERIOD_OPTIONS, sp.period) ? sp.period : "";
  const { fromDate, toDate } = periodToRange(period);
  const [jobs, contracts, session] = await Promise.all([
    listMaintenance({ status, fromDate, toDate }),
    listMaintenanceContracts().catch(() => []),
    requireSession(),
  ]);
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mantenimientos</h1>
        <p className="text-sm text-muted-foreground">
          {contracts.length} contratos · {jobs.length} trabajos
        </p>
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
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(status || period) && (
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
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Cliente</th>
                  <th className="py-2 text-left">Programado</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-muted/50">
                    <td className="py-2">
                      <Link href={`/mantenimientos/${j.id}`} className="text-primary hover:underline">
                        {j.customer_name ?? "—"}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString("es-ES") : "—"}
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
