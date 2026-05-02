import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { KpiCard } from "@/shared/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function DashboardPage() {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

  const [
    { count: leadsCount },
    { count: customersCount },
    { count: contractsMonth },
    { count: installationsMonth },
    salesMonthRes,
    salesYearRes,
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
    supabase.from("sales_records").select("total_cents").gte("recorded_at", yearStart),
  ]);

  const totalMonth = ((salesMonthRes.data ?? []) as { total_cents: number }[]).reduce(
    (s, r) => s + r.total_cents,
    0,
  );
  const totalYear = ((salesYearRes.data ?? []) as { total_cents: number }[]).reduce(
    (s, r) => s + r.total_cents,
    0,
  );

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

      <Card>
        <CardHeader>
          <CardTitle>Comparativas y gráficas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Las gráficas comparativas (mes vs mes, año vs año, ranking comerciales, funnel
            comercial) se añadirán al pulir el módulo Dashboard tras la auditoría.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
