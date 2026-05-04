import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { KpiCard } from "@/shared/components/kpi-card";
import {
  SalesByMonthChart,
  FunnelChart,
  YearComparisonChart,
} from "@/modules/dashboard/charts";
import {
  getDashboardObjectives,
  getMonthRanking,
} from "@/modules/sales/dashboard-actions";
import { DashboardObjectivesCard } from "@/modules/sales/dashboard-objectives-card";
import { RankingCard } from "@/modules/sales/ranking-card";
import { DashboardFilters } from "@/modules/sales/dashboard-filters";
import { listTeamMembers } from "@/modules/agenda/actions";
import {
  UpcomingMaintenanceCard,
  getUpcomingMaintenance,
} from "@/modules/maintenance/upcoming-card";
import {
  UpcomingInstallationsCard,
  getUpcomingInstallations,
} from "@/modules/installations/upcoming-card";
import {
  CriticalIncidentsCard,
  getCriticalOpenIncidents,
} from "@/modules/incidents/critical-card";
import { getMonthlyEvolution } from "@/modules/dashboard/evolution-actions";
import { EvolutionChart } from "@/modules/dashboard/evolution-chart";

export const dynamic = "force-dynamic";

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default async function DashboardPage(props: {
  searchParams: Promise<{ dept?: string; user?: string }>;
}) {
  try {
    return await renderDashboard(props);
  } catch (err) {
    console.error("[DashboardPage]", err);
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hola {(await requireSession()).full_name ?? ""}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6">
          <div className="text-3xl">⚠️</div>
          <h2 className="mt-2 text-lg font-bold text-amber-900">
            El dashboard no se pudo cargar completamente
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Probablemente falta aplicar alguna migración SQL en Supabase. Mientras tanto puedes
            usar el resto del menú con normalidad.
          </p>
          {err instanceof Error && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-amber-900">
                Detalles técnicos
              </summary>
              <pre className="mt-2 overflow-auto rounded-md bg-amber-100 p-3 text-xs text-amber-900">
                {err.message}
                {err.stack ? `\n\n${err.stack}` : ""}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

async function renderDashboard({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; user?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filterDept =
    sp.dept === "tech" || sp.dept === "sales" || sp.dept === "tmk" ? sp.dept : undefined;
  const filterUser = sp.user || undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
  const lastYearEnd = new Date(now.getFullYear(), 0, 0, 23, 59, 59).toISOString();

  const [
    { count: leadsCount },
    { count: customersCount },
    { count: contractsMonth },
    { count: installationsMonth },
    salesYearRes,
    salesLastYearRes,
    leadsByStatusRes,
    objectives,
    ranking,
    teamMembers,
  ] = await Promise.all([
    // Sólo leads activos (no convertidos / no perdidos / no caducados): el
    // lead convertido vive ahora como cliente y no debe contabilizarse aquí.
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .in("status", [
        "new",
        "contacted",
        "free_trial_proposed",
        "proposal_created",
        "proposal_sent",
      ]),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart),
    supabase
      .from("installations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart),
    supabase
      .from("sales_records")
      .select("total_cents, recorded_at")
      .gte("recorded_at", yearStart),
    supabase
      .from("sales_records")
      .select("total_cents, recorded_at")
      .gte("recorded_at", lastYearStart)
      .lte("recorded_at", lastYearEnd),
    supabase.from("leads").select("status").is("deleted_at", null),
    getDashboardObjectives(filterUser, filterDept),
    getMonthRanking(filterDept).catch(() => []),
    listTeamMembers().catch(() => []),
  ]);

  const [upcomingMaintenance, upcomingInstallations, criticalIncidents, evolution] =
    await Promise.all([
      getUpcomingMaintenance().catch(() => []),
      getUpcomingInstallations().catch(() => []),
      getCriticalOpenIncidents().catch(() => []),
      getMonthlyEvolution().catch(() => []),
    ]);

  const totalYear = ((salesYearRes.data ?? []) as { total_cents: number }[]).reduce(
    (s, r) => s + r.total_cents,
    0,
  );

  const sixMonths = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  type SR = { total_cents: number; recorded_at: string };
  const yearRows = (salesYearRes.data ?? []) as SR[];
  const lastYearRows = (salesLastYearRes.data ?? []) as SR[];
  const sumByMonth = (rows: SR[], y: number, m: number) =>
    rows
      .filter((r) => {
        const d = new Date(r.recorded_at);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((s, r) => s + r.total_cents, 0);
  const salesData = sixMonths.map((d) => ({
    month: MONTHS_SHORT[d.month]!,
    total_eur: sumByMonth(yearRows, d.year, d.month) / 100,
  }));
  const yearMonthly = Array.from({ length: 12 }).map((_, m) => ({
    month: MONTHS_SHORT[m]!,
    total_eur: sumByMonth(yearRows, now.getFullYear(), m) / 100,
  }));
  const lastYearMonthly = Array.from({ length: 12 }).map((_, m) => ({
    month: MONTHS_SHORT[m]!,
    total_eur: sumByMonth(lastYearRows, now.getFullYear() - 1, m) / 100,
  }));

  const leadStatuses = ((leadsByStatusRes.data ?? []) as { status: string }[]).reduce<
    Record<string, number>
  >((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});
  const totalLeads = Object.values(leadStatuses).reduce((s, v) => s + v, 0);
  const contacted =
    (leadStatuses.contacted ?? 0) +
    (leadStatuses.proposal_created ?? 0) +
    (leadStatuses.proposal_sent ?? 0) +
    (leadStatuses.free_trial_proposed ?? 0) +
    (leadStatuses.converted ?? 0);
  const proposed =
    (leadStatuses.proposal_sent ?? 0) +
    (leadStatuses.free_trial_proposed ?? 0) +
    (leadStatuses.converted ?? 0);
  const converted = leadStatuses.converted ?? 0;
  const funnelData = [
    { step: "Leads", count: totalLeads },
    { step: "Contactados", count: contacted },
    { step: "Propuesta enviada", count: proposed },
    { step: "Convertidos", count: converted },
  ];

  const isLevel1 = objectives.level === 1;
  const isLevel3 = objectives.level === 3;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hola {session.full_name ?? session.email} 👋
            {objectives.level === 2 && " — vista de tu departamento"}
            {objectives.level === 3 && " — vista personal"}
          </p>
        </div>
        {(isLevel1 || objectives.level === 2) && (
          <DashboardFilters
            users={teamMembers.map((t) => ({ id: t.user_id, name: t.full_name }))}
            showDeptFilter={isLevel1}
          />
        )}
      </div>

      {/* Cabecera totales: el destacado es scope (yo / equipo / empresa según rol),
          y secundario el total empresa para nivel 2/3 */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={
            isLevel3
              ? "Mi venta este mes"
              : objectives.level === 2
                ? "Equipo este mes"
                : "Vendido este mes"
          }
          value={formatCents(objectives.scope_month_total_cents)}
          icon="TrendingUp"
          iconColor="primary"
        />
        {!isLevel1 && (
          <KpiCard
            label="Total empresa este mes"
            value={formatCents(objectives.company_month_total_cents)}
            icon="Wallet"
            iconColor="success"
          />
        )}
        <KpiCard label="Leads activos" value={leadsCount ?? 0} icon="Contact" iconColor="primary" />
        <KpiCard label="Clientes" value={customersCount ?? 0} icon="Users" iconColor="success" />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Contratos / mes"
          value={contractsMonth ?? 0}
          icon="FileSignature"
          iconColor="warning"
        />
        <KpiCard
          label="Instalaciones / mes"
          value={installationsMonth ?? 0}
          icon="Wrench"
          iconColor="destructive"
        />
        <KpiCard
          label="Vendido este año"
          value={formatCents(totalYear)}
          icon="Wallet"
          iconColor="primary"
        />
      </div>

      {/* Objetivos: individual + departamento */}
      <div className="grid gap-5 lg:grid-cols-2">
        <DashboardObjectivesCard
          title={isLevel3 ? "Mis objetivos" : "Objetivos individuales"}
          icon="individual"
          data={objectives.individual}
          emptyMsg={
            isLevel3
              ? "No tienes objetivos individuales este mes."
              : "Sin objetivos individuales para el filtro actual."
          }
        />
        <DashboardObjectivesCard
          title="Objetivos del departamento"
          icon="team"
          data={objectives.department_objectives}
          emptyMsg="Sin objetivos de departamento definidos."
        />
      </div>

      <CriticalIncidentsCard items={criticalIncidents} />

      {/* Próximas instalaciones + mantenimientos */}
      <div className="grid gap-5 lg:grid-cols-2">
        <UpcomingInstallationsCard items={upcomingInstallations} />
        <UpcomingMaintenanceCard items={upcomingMaintenance} />
      </div>

      <RankingCard rows={ranking} highlightUserId={session.user_id} />

      <div className="grid gap-5 lg:grid-cols-2">
        <SalesByMonthChart data={salesData} />
        <FunnelChart data={funnelData} />
      </div>

      <YearComparisonChart thisYear={yearMonthly} lastYear={lastYearMonthly} />

      {evolution.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <EvolutionChart data={evolution} metric="sales_cents" title="Ventas (€) últimos 12 meses" />
          <EvolutionChart data={evolution} metric="contracts" title="Contratos firmados últimos 12 meses" />
        </div>
      )}
    </div>
  );
}
