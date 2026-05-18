import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  UserMinus,
  Clock,
  Truck,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";

export interface InstallationAlerts {
  tomorrow_no_installer: number;
  vans_without_technician: number;
  in_progress_too_long: number; // started_at > 4h sin completar
  scheduled_in_past: number;    // status=scheduled con scheduled_at < hoy (retrasada)
}

export function InstallationSmartAlerts({ alerts }: { alerts: InstallationAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.tomorrow_no_installer > 0)
    items.push({
      key: "no_installer",
      label: "Mañana sin instalador",
      value: alerts.tomorrow_no_installer,
      icon: UserMinus,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/instalaciones",
    });
  if (alerts.in_progress_too_long > 0)
    items.push({
      key: "long_in_progress",
      label: "En curso >4h sin cerrar",
      value: alerts.in_progress_too_long,
      icon: Clock,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/instalaciones?status=in_progress",
    });
  if (alerts.scheduled_in_past > 0)
    items.push({
      key: "past_scheduled",
      label: "Retrasadas (fecha pasada)",
      value: alerts.scheduled_in_past,
      icon: CalendarClock,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/instalaciones?status=scheduled",
    });
  if (alerts.vans_without_technician > 0)
    items.push({
      key: "vans",
      label: "Furgonetas sin técnico",
      value: alerts.vans_without_technician,
      icon: Truck,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/almacenes",
    });

  if (items.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Operativa al día. Todas las instalaciones de mañana tienen
          técnico asignado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Alertas operativas
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

export async function getInstallationAlerts(): Promise<InstallationAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: InstallationAlerts = {
    tomorrow_no_installer: 0,
    vans_without_technician: 0,
    in_progress_too_long: 0,
    scheduled_in_past: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400000 - 1000);
  const fourHoursAgo = new Date(now.getTime() - 4 * 3600000);

  // 1) Mañana sin instalador asignado
  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "scheduled")
      .is("installer_user_id", null)
      .gte("scheduled_at", tomorrowStart.toISOString())
      .lte("scheduled_at", tomorrowEnd.toISOString())
      .is("deleted_at", null);
    out.tomorrow_no_installer = count ?? 0;
  } catch {
    /* */
  }

  // 2) En curso >4h
  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "in_progress")
      .lt("started_at", fourHoursAgo.toISOString())
      .is("deleted_at", null);
    out.in_progress_too_long = count ?? 0;
  } catch {
    /* */
  }

  // 3) Programadas con fecha pasada (retrasadas)
  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "scheduled")
      .lt("scheduled_at", todayStart.toISOString())
      .is("deleted_at", null);
    out.scheduled_in_past = count ?? 0;
  } catch {
    /* */
  }

  // 4) Furgonetas sin técnico asignado
  try {
    const { count } = await admin
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("kind", "vehicle")
      .is("assigned_user_id", null)
      .is("deleted_at", null);
    out.vans_without_technician = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
