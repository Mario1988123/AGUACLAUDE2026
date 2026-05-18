import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Hourglass, CalendarX, Gift, AlertTriangle } from "lucide-react";

export interface FreeTrialAlerts {
  expiring_7d: number;
  expired_without_decision: number;
  installed_total: number;
}

export function FreeTrialSmartAlerts({ alerts }: { alerts: FreeTrialAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.expiring_7d > 0)
    items.push({
      key: "expiring",
      label: "Caducan en <7 días",
      value: alerts.expiring_7d,
      icon: Hourglass,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/pruebas-gratuitas",
    });
  if (alerts.expired_without_decision > 0)
    items.push({
      key: "expired",
      label: "Caducadas sin decisión",
      value: alerts.expired_without_decision,
      icon: CalendarX,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/pruebas-gratuitas",
    });
  if (alerts.installed_total > 0)
    items.push({
      key: "installed",
      label: "Instaladas en clientes",
      value: alerts.installed_total,
      icon: Gift,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/pruebas-gratuitas",
    });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Estado de pruebas
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-3">
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

export async function getFreeTrialAlerts(): Promise<FreeTrialAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: FreeTrialAlerts = {
    expiring_7d: 0,
    expired_without_decision: 0,
    installed_total: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const today = new Date().toISOString().slice(0, 10);
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  try {
    const { count } = await admin
      .from("free_trials")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "installed")
      .gte("expires_at", today)
      .lte("expires_at", next7);
    out.expiring_7d = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("free_trials")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "installed")
      .lt("expires_at", today);
    out.expired_without_decision = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("free_trials")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "installed");
    out.installed_total = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
