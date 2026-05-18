import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Clock, AlertTriangle, UserMinus, TrendingUp } from "lucide-react";

export interface IncidentAlerts {
  sla_violated: number;
  high_priority_unassigned: number;
  open_old: number; // abiertas > 14d
  resolved_this_week: number;
}

export function IncidentSmartAlerts({ alerts }: { alerts: IncidentAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.sla_violated > 0)
    items.push({
      key: "sla",
      label: "SLA vencido sin resolver",
      value: alerts.sla_violated,
      icon: Clock,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/incidencias",
    });
  if (alerts.high_priority_unassigned > 0)
    items.push({
      key: "high",
      label: "Alta prioridad sin responsable",
      value: alerts.high_priority_unassigned,
      icon: AlertTriangle,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/incidencias",
    });
  if (alerts.open_old > 0)
    items.push({
      key: "old",
      label: "Abiertas >14 días",
      value: alerts.open_old,
      icon: UserMinus,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/incidencias",
    });
  if (alerts.resolved_this_week > 0)
    items.push({
      key: "resolved",
      label: "Resueltas esta semana",
      value: alerts.resolved_this_week,
      icon: TrendingUp,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      href: "/incidencias?status=resolved",
    });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🧠 Estado de incidencias
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.key}
                href={it.href as never}
                className={`flex items-center gap-3 rounded-xl border-2 p-3 hover:opacity-80 ${it.color}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-extrabold tabular-nums">{it.value}</div>
                  <div className="text-xs">{it.label}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export async function getIncidentAlerts(): Promise<IncidentAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: IncidentAlerts = {
    sla_violated: 0,
    high_priority_unassigned: 0,
    open_old: 0,
    resolved_this_week: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();
  const past14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const weekStart = new Date(Date.now() - 7 * 86400000).toISOString();

  try {
    const { count } = await admin
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["open", "assigned", "in_progress"])
      .lt("deadline_at", now);
    out.sla_violated = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["open"])
      .in("priority", ["high", "critical"])
      .is("assigned_to", null);
    out.high_priority_unassigned = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["open", "assigned", "in_progress"])
      .lt("created_at", past14);
    out.open_old = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["resolved", "closed"])
      .gte("resolved_at", weekStart);
    out.resolved_this_week = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
