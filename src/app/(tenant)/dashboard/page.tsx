import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { KpiCard } from "@/shared/components/kpi-card";
import {
  SalesByMonthChart,
  FunnelChart,
  YearComparisonChart,
} from "@/modules/dashboard/charts";

export const dynamic = "force-dynamic";

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default async function DashboardPage() {
  const session = await requireSession();
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
    salesMonthRes,
    salesYearRes,
    salesLastYearRes,
    leadsByStatusRes,
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null),
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
    supabase.from("sales_records").select("total_cents").gte("recorded_at", monthStart),
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
  ]);

  const totalMonth = ((salesMonthRes.data ?? []) as { total_cents: number }[]).reduce(
    (s, r) => s + r.total_cents,
    0,
  );
  const totalYear = ((salesYearRes.data ?? []) as { total_cents: number }[]).reduce(
    (s, r) => s + r.total_cents,
    0,
  );

  // Series mensuales últimos 6 meses
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

  // Funnel comercial
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hola {session.full_name ?? session.email} 👋
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Leads activos" value={leadsCount ?? 0} icon="Contact" iconColor="primary" />
        <KpiCard label="Clientes" value={customersCount ?? 0} icon="Users" iconColor="success" />
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
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <KpiCard
          label="Vendido este mes"
          value={formatCents(totalMonth)}
          icon="TrendingUp"
          iconColor="primary"
        />
        <KpiCard
          label="Vendido este año"
          value={formatCents(totalYear)}
          icon="Wallet"
          iconColor="success"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SalesByMonthChart data={salesData} />
        <FunnelChart data={funnelData} />
      </div>

      <YearComparisonChart thisYear={yearMonthly} lastYear={lastYearMonthly} />
    </div>
  );
}
