import Link from "next/link";
import { listCompanies, getCompaniesMetrics } from "@/modules/superadmin/companies/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Building2, Users, Contact, FileSignature } from "lucide-react";
import { ErrorReportsSuperadminCard } from "@/modules/error-reports/superadmin-card";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["trial", "active", "suspended", "cancelled"] as const;

const statusVariant = {
  trial: "warning",
  active: "success",
  suspended: "destructive",
  cancelled: "secondary",
} as const;

const statusLabel = {
  trial: "Prueba",
  active: "Activa",
  suspended: "Suspendida",
  cancelled: "Cancelada",
} as const;

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default async function SuperadminCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUS_OPTIONS.includes(sp.status as never) ? sp.status : undefined;
  const companies = await listCompanies({ status });
  const metrics = await getCompaniesMetrics(companies.map((c) => c.id)).catch(() => new Map());

  // Totales globales
  const totalUsers = Array.from(metrics.values()).reduce((s, m) => s + m.users_count, 0);
  const totalLeads = Array.from(metrics.values()).reduce((s, m) => s + m.leads_count, 0);
  const totalCustomers = Array.from(metrics.values()).reduce((s, m) => s + m.customers_count, 0);
  const totalActiveContracts = Array.from(metrics.values()).reduce(
    (s, m) => s + m.contracts_active_count,
    0,
  );
  const totalMonthlyRevenue = companies
    .filter((c) => c.status === "active" || c.status === "trial")
    .reduce((s, c) => s + c.monthly_cost_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-muted-foreground">{companies.length} empresas registradas</p>
        </div>
        <Button asChild>
          <Link href={"/superadmin/empresas/nueva" as never}>+ Nueva empresa</Link>
        </Button>
      </div>

      {/* Métricas globales */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border-2 border-primary/20 bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Building2 className="h-4 w-4" /> Empresas
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{companies.length}</div>
        </div>
        <div className="rounded-2xl border-2 border-success/20 bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Users className="h-4 w-4" /> Usuarios
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{totalUsers}</div>
        </div>
        <div className="rounded-2xl border-2 border-warning/20 bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Contact className="h-4 w-4" /> Leads
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{totalLeads}</div>
        </div>
        <div className="rounded-2xl border-2 border-warning/20 bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <FileSignature className="h-4 w-4" /> Clientes / contratos
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">
            {totalCustomers} / {totalActiveContracts}
          </div>
        </div>
        <div className="rounded-2xl border-2 border-success/40 bg-success/5 p-4">
          <div className="text-xs uppercase text-muted-foreground">Ingresos mensuales</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-success">
            {formatCents(totalMonthlyRevenue)}
          </div>
        </div>
      </div>

      <ErrorReportsSuperadminCard />

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
                {statusLabel[s]}
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
        {status && (
          <Link href="/superadmin" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Empresa</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Usuarios</th>
              <th className="px-4 py-3 text-right">Leads</th>
              <th className="px-4 py-3 text-right">Clientes</th>
              <th className="px-4 py-3 text-right">Contratos</th>
              <th className="px-4 py-3 text-right">Coste/mes</th>
              <th className="px-4 py-3 text-right">Edad</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  Sin empresas con esos filtros.
                </td>
              </tr>
            ) : (
              companies.map((c) => {
                const st = c.status as keyof typeof statusVariant;
                const m = metrics.get(c.id);
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/superadmin/empresas/${c.id}` as never}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{c.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[st]}>{statusLabel[st]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m?.users_count ?? 0}
                      <span className="text-xs text-muted-foreground"> / {c.max_users}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{m?.leads_count ?? 0}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m?.customers_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {m?.contracts_active_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCents(c.monthly_cost_cents)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {daysSince(c.created_at)} d
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/superadmin/empresas/${c.id}` as never}
                        className="text-sm text-primary hover:underline"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
