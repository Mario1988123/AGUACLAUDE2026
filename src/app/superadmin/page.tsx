import Link from "next/link";
import { listCompanies, getCompaniesMetrics } from "@/modules/superadmin/companies/actions";
import { Button } from "@/shared/ui/button";
import { StatusPill } from "@/shared/components/status-pill";
import { Building2, Users, FileSignature, Euro, Search, Plus, ShieldCheck } from "lucide-react";
import { ErrorReportsSuperadminCard } from "@/modules/error-reports/superadmin-card";
import { AccionesRapidasEmpresa } from "@/modules/superadmin/companies/ciclo-vida-ui";
import { TarjetaEmpresa } from "@/modules/superadmin/companies/tarjeta-empresa";
import {
  ESTADO_EMPRESA,
  estadoEmpresa,
  esEmpresaProtegida,
  type EstadoEmpresa,
} from "@/shared/lib/empresas/estado";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: EstadoEmpresa[] = ["trial", "active", "suspended", "cancelled"];

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default async function SuperadminCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = STATUS_OPTIONS.includes(sp.status as EstadoEmpresa) ? sp.status : undefined;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const companies = await listCompanies({ status, q });
  const metrics = await getCompaniesMetrics(companies.map((c) => c.id)).catch(() => new Map());

  // Totales de las empresas listadas
  const totalUsers = Array.from(metrics.values()).reduce((s, m) => s + m.users_count, 0);
  const totalCustomers = Array.from(metrics.values()).reduce((s, m) => s + m.customers_count, 0);
  const totalActiveContracts = Array.from(metrics.values()).reduce(
    (s, m) => s + m.contracts_active_count,
    0,
  );
  const totalMonthlyRevenue = companies
    .filter((c) => c.status === "active" || c.status === "trial")
    .reduce((s, c) => s + c.monthly_cost_cents, 0);
  const pausadas = companies.filter((c) => c.status === "suspended").length;

  const kpis = [
    {
      label: "Empresas",
      value: String(companies.length),
      sub: pausadas ? `${pausadas} en pausa` : null,
      icon: Building2,
      tono: "text-primary bg-primary/10",
    },
    { label: "Usuarios", value: String(totalUsers), sub: null, icon: Users, tono: "text-success bg-success/15" },
    {
      label: "Clientes · contratos",
      value: `${totalCustomers} · ${totalActiveContracts}`,
      sub: null,
      icon: FileSignature,
      tono: "text-warning bg-warning/15",
    },
    {
      label: "Ingresos al mes",
      value: formatCents(totalMonthlyRevenue),
      sub: null,
      icon: Euro,
      tono: "text-success bg-success/15",
    },
  ];

  const filtrado = Boolean(status || q);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length} {filtrado ? "con esos filtros" : "registradas"}
          </p>
        </div>
        <Button asChild className="hidden md:inline-flex">
          <Link href={"/superadmin/empresas/nueva" as never}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nueva empresa
          </Link>
        </Button>
      </div>

      {/* Indicadores: 2×2 en móvil, una fila en escritorio */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${k.tono}`}
              >
                <k.icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="truncate text-xs font-medium text-muted-foreground">{k.label}</span>
            </div>
            <div className="mt-2 truncate text-xl font-bold tabular-nums sm:text-2xl">{k.value}</div>
            {k.sub ? <div className="text-xs text-warning">{k.sub}</div> : null}
          </div>
        ))}
      </div>

      <ErrorReportsSuperadminCard />

      {/* Buscador y filtro (GET, en servidor) */}
      <form className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end sm:p-4">
        <div className="space-y-1">
          <label htmlFor="buscar-empresa" className="text-xs uppercase text-muted-foreground">
            Buscar
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="buscar-empresa"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Nombre o slug"
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-base md:text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="estado-empresa" className="text-xs uppercase text-muted-foreground">
            Estado
          </label>
          <select
            id="estado-empresa"
            name="status"
            defaultValue={status ?? ""}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {ESTADO_EMPRESA[s].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:flex-none"
          >
            Aplicar
          </button>
          {filtrado && (
            <Link
              href="/superadmin"
              className="inline-flex h-11 items-center px-2 text-sm text-muted-foreground hover:underline"
            >
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {companies.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Sin empresas con esos filtros.
        </p>
      ) : (
        <>
          {/* Móvil y tableta: tarjetas */}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {companies.map((c) => {
              const m = metrics.get(c.id);
              return (
                <TarjetaEmpresa
                  key={c.id}
                  empresa={c}
                  usuarios={m?.users_count ?? 0}
                  clientes={m?.customers_count ?? 0}
                  contratos={m?.contracts_active_count ?? 0}
                />
              );
            })}
          </ul>

          {/* Escritorio: tabla */}
          <div className="hidden rounded-lg border bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Empresa</th>
                  <th className="px-3 py-3 text-left">Estado</th>
                  <th className="px-3 py-3 text-right">Usuarios</th>
                  <th className="px-3 py-3 text-right">Leads</th>
                  <th className="px-3 py-3 text-right">Clientes</th>
                  <th className="px-3 py-3 text-right">Contratos</th>
                  <th className="px-3 py-3 text-right">Coste/mes</th>
                  <th className="px-3 py-3 text-right">Edad</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {companies.map((c) => {
                  const m = metrics.get(c.id);
                  const e = estadoEmpresa(c.status);
                  return (
                    <tr key={c.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/superadmin/empresas/${c.id}` as never}
                          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                        >
                          {c.name}
                          {esEmpresaProtegida(c.id) ? (
                            <ShieldCheck className="h-4 w-4 text-success" aria-label="Protegida" />
                          ) : null}
                        </Link>
                        <div className="text-xs text-muted-foreground">{c.slug}</div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill label={e.label} tone={e.tono} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {m?.users_count ?? 0}
                        <span className="text-xs text-muted-foreground"> / {c.max_users}</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{m?.leads_count ?? 0}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {m?.customers_count ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {m?.contracts_active_count ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatCents(c.monthly_cost_cents)}
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">
                        {daysSince(c.created_at)} d
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <div className="flex w-32">
                            <AccionesRapidasEmpresa
                              companyId={c.id}
                              nombre={c.name}
                              status={c.status}
                            />
                          </div>
                          <Button asChild variant="ghost" className="h-11">
                            <Link href={`/superadmin/empresas/${c.id}` as never}>Editar</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Móvil: «Nueva empresa» fija abajo */}
      <div className="sticky bottom-[calc(var(--safe-bottom)+0.75rem)] z-10 md:hidden">
        <Button asChild className="h-12 w-full rounded-xl shadow-lg">
          <Link href={"/superadmin/empresas/nueva" as never}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nueva empresa
          </Link>
        </Button>
      </div>
    </div>
  );
}
