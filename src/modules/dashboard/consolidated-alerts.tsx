import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { AlertOctagon } from "lucide-react";

interface ModuleSummary {
  module: string;
  label: string;
  emoji: string;
  count: number;
  href: string;
}

export interface ConsolidatedAlerts {
  total: number;
  modules: ModuleSummary[];
}

export function ConsolidatedAlertsCard({ data }: { data: ConsolidatedAlerts }) {
  if (data.total === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="py-4 text-center text-sm text-emerald-900">
          ✓ Sin alertas en ningún módulo. Todo al día.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-2 border-red-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertOctagon className="h-5 w-5 text-red-600" />
          Hoy necesitas atender ({data.total} cosas)
          <Badge variant="destructive">{data.total}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.modules
            .filter((m) => m.count > 0)
            .sort((a, b) => b.count - a.count)
            .map((m) => (
              <Link
                key={m.module}
                href={m.href as never}
                className="flex items-center justify-between rounded-xl border-2 border-red-200 bg-red-50/50 p-3 text-red-900 hover:bg-red-50"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-xl">{m.emoji}</span>
                  <span className="font-semibold">{m.label}</span>
                </span>
                <span className="text-2xl font-extrabold tabular-nums">{m.count}</span>
              </Link>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

export async function getConsolidatedAlerts(): Promise<ConsolidatedAlerts> {
  // Importamos en paralelo todos los get<Modulo>Alerts y los sumamos.
  const [
    leads,
    customers,
    installations,
    maintenance,
    products,
    proposals,
    contracts,
    invoices,
    wallet,
    incidents,
    trials,
  ] = await Promise.all([
    import("@/modules/leads/smart-alerts").then((m) => m.getLeadAlerts(null)).catch(() => null),
    import("@/modules/customers/smart-alerts").then((m) => m.getCustomerAlerts()).catch(() => null),
    import("@/modules/installations/smart-alerts").then((m) => m.getInstallationAlerts()).catch(() => null),
    import("@/modules/maintenance/smart-alerts").then((m) => m.getMaintenanceAlerts()).catch(() => null),
    import("@/modules/products/smart-alerts").then((m) => m.getProductAlerts()).catch(() => null),
    import("@/modules/proposals/smart-alerts").then((m) => m.getProposalAlerts()).catch(() => null),
    import("@/modules/contracts/smart-alerts").then((m) => m.getContractAlerts()).catch(() => null),
    import("@/modules/invoices/smart-alerts").then((m) => m.getInvoiceAlerts()).catch(() => null),
    import("@/modules/wallet/smart-alerts").then((m) => m.getWalletAlerts()).catch(() => null),
    import("@/modules/incidents/smart-alerts").then((m) => m.getIncidentAlerts()).catch(() => null),
    import("@/modules/free-trials/smart-alerts").then((m) => m.getFreeTrialAlerts()).catch(() => null),
  ]);

  const sum = (obj: Record<string, unknown> | null): number => {
    if (!obj) return 0;
    let s = 0;
    for (const v of Object.values(obj)) {
      if (typeof v === "number") s += v;
      else if (typeof v === "boolean" && v) s += 1;
    }
    return s;
  };

  const modules: ModuleSummary[] = [
    {
      module: "leads",
      label: "Leads",
      emoji: "🌡",
      count: sum(leads as unknown as Record<string, unknown>),
      href: "/leads",
    },
    {
      module: "customers",
      label: "Clientes",
      emoji: "👥",
      count: sum(customers as unknown as Record<string, unknown>),
      href: "/clientes",
    },
    {
      module: "installations",
      label: "Instalaciones",
      emoji: "🔧",
      count: sum(installations as unknown as Record<string, unknown>),
      href: "/instalaciones",
    },
    {
      module: "maintenance",
      label: "Mantenimientos",
      emoji: "🛠",
      count: sum(maintenance as unknown as Record<string, unknown>),
      href: "/mantenimientos",
    },
    {
      module: "products",
      label: "Productos",
      emoji: "📦",
      count: sum(products as unknown as Record<string, unknown>),
      href: "/productos",
    },
    {
      module: "proposals",
      label: "Propuestas",
      emoji: "📝",
      count: sum(proposals as unknown as Record<string, unknown>),
      href: "/propuestas",
    },
    {
      module: "contracts",
      label: "Contratos",
      emoji: "📄",
      count: sum(contracts as unknown as Record<string, unknown>),
      href: "/contratos",
    },
    {
      module: "invoices",
      label: "Facturas",
      emoji: "🧾",
      count: sum(invoices as unknown as Record<string, unknown>),
      href: "/facturas",
    },
    {
      module: "wallet",
      label: "Cobros",
      emoji: "💰",
      count: sum(wallet as unknown as Record<string, unknown>),
      href: "/wallet",
    },
    {
      module: "incidents",
      label: "Incidencias",
      emoji: "🚨",
      count: sum(incidents as unknown as Record<string, unknown>),
      href: "/incidencias",
    },
    {
      module: "trials",
      label: "Pruebas",
      emoji: "🎁",
      count: sum(trials as unknown as Record<string, unknown>),
      href: "/pruebas-gratuitas",
    },
  ];

  const total = modules.reduce((s, m) => s + m.count, 0);
  return { total, modules };
}
