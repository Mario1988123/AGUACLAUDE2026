import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const KPI_GROUPS = [
  {
    role: "Comercial (sales_rep)",
    kpis: [
      "Leads activos",
      "Propuestas en negociación",
      "Contratos firmados (mes)",
      "Comisión acumulada (mes)",
      "Top productos vendidos",
    ],
  },
  {
    role: "Director comercial",
    kpis: [
      "Pipeline equipo",
      "Conversión lead → contrato (%)",
      "Ranking comerciales",
      "Objetivos vs realidad (mes)",
      "Tiempo medio cierre",
    ],
  },
  {
    role: "Director técnico",
    kpis: [
      "Instalaciones pendientes",
      "Carga de instaladores",
      "Incidencias abiertas",
      "SLA cumplimiento",
      "Stock mínimo",
    ],
  },
  {
    role: "Instalador",
    kpis: [
      "Mis tareas hoy",
      "Próximas instalaciones",
      "Mantenimientos pendientes",
      "Mis puntos (mes)",
    ],
  },
  {
    role: "Admin / Superadmin",
    kpis: [
      "Facturación (mes)",
      "Cobros pendientes",
      "MRR (Monthly Recurring Revenue)",
      "Churn rate",
      "Top clientes por LTV",
    ],
  },
];

export default async function ConfigDashboardPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Cada usuario ve un dashboard con los KPIs propios de su rol. El
            sistema decide la composición de tarjetas a partir del rol activo.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      {KPI_GROUPS.map((g) => (
        <Card key={g.role}>
          <CardHeader>
            <CardTitle className="text-base">{g.role}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {g.kpis.map((k) => (
                <li
                  key={k}
                  className="rounded-lg border bg-card px-3 py-1.5 text-muted-foreground"
                >
                  • {k}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
