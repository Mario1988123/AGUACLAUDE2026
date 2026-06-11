import Link from "next/link";
import { AlertTriangle, Calendar, Frown, PhoneCall, UserMinus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export interface MaintenanceAlerts {
  overdue: number;          // status scheduled con scheduled_at < hoy - 30d
  unassigned_next_7d: number;
  low_nps_30d: number;       // últimos 30d con NPS <=2
  active_contracts_without_job: number; // contratos activos sin job programado
  pending_confirmation_30d: number; // preprogrammed sin confirmed_at en próximos 30d
}

export function MaintenanceSmartAlerts({ alerts }: { alerts: MaintenanceAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.pending_confirmation_30d > 0) {
    items.push({
      key: "pending_confirm",
      label: "Por confirmar (próximos 30d)",
      value: alerts.pending_confirmation_30d,
      icon: PhoneCall,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/mantenimientos/por-confirmar",
    });
  }
  if (alerts.overdue > 0) {
    items.push({
      key: "overdue",
      label: "Vencidos sin completar",
      value: alerts.overdue,
      icon: AlertTriangle,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/mantenimientos?status=scheduled&period=past",
    });
  }
  if (alerts.unassigned_next_7d > 0) {
    items.push({
      key: "unassigned",
      label: "Sin técnico próximos 7d",
      value: alerts.unassigned_next_7d,
      icon: UserMinus,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/mantenimientos?status=scheduled&period=upcoming",
    });
  }
  if (alerts.low_nps_30d > 0) {
    items.push({
      key: "nps",
      label: "NPS bajo (≤2) últimos 30d",
      value: alerts.low_nps_30d,
      icon: Frown,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/mantenimientos?status=completed",
    });
  }
  if (alerts.active_contracts_without_job > 0) {
    items.push({
      key: "no_job",
      label: "Contratos activos sin próximo job",
      value: alerts.active_contracts_without_job,
      icon: Calendar,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/contratos?status=active",
    });
  }

  if (items.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Todo al día. Sin vencidos ni huecos sin técnico.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🧠 Alertas inteligentes
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
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

export async function getMaintenanceAlerts(): Promise<MaintenanceAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  if (!session.company_id) {
    return {
      overdue: 0,
      unassigned_next_7d: 0,
      low_nps_30d: 0,
      active_contracts_without_job: 0,
      pending_confirmation_30d: 0,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const todayIso = new Date().toISOString();
  const next7 = new Date();
  next7.setDate(next7.getDate() + 7);
  const next7Iso = next7.toISOString();

  // 1) Vencidos sin completar (status scheduled con scheduled_at en el pasado)
  let overdue = 0;
  try {
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "scheduled")
      .lt("scheduled_at", todayIso);
    overdue = count ?? 0;
  } catch {
    /* */
  }

  // 2) Sin técnico próximos 7d
  let unassigned_next_7d = 0;
  try {
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "scheduled")
      .is("technician_user_id", null)
      .gte("scheduled_at", todayIso)
      .lte("scheduled_at", next7Iso);
    unassigned_next_7d = count ?? 0;
  } catch {
    /* */
  }

  // 3) NPS bajo últimos 30d. maintenance_jobs NO tiene columna nps_score (el NPS
  // no se captura todavía), así que esta métrica queda en 0 sin lanzar la query
  // (antes fallaba siempre en silencio). Reactivar cuando exista la captura de NPS.
  const low_nps_30d = 0;

  // 4) Contratos activos sin job programado futuro
  let active_contracts_without_job = 0;
  try {
    const { data: contracts } = await admin
      .from("contracts")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("status", "active")
      .eq("maintenance_included", true)
      .is("deleted_at", null);
    const contractIds = ((contracts ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contractIds.length > 0) {
      const { data: withJob } = await admin
        .from("maintenance_jobs")
        .select("contract_id")
        .in("contract_id", contractIds)
        .in("status", ["scheduled", "in_progress"])
        .gte("scheduled_at", todayIso);
      const withJobSet = new Set(
        ((withJob ?? []) as Array<{ contract_id: string | null }>)
          .map((j) => j.contract_id)
          .filter((v): v is string => !!v),
      );
      active_contracts_without_job = contractIds.filter(
        (id) => !withJobSet.has(id),
      ).length;
    }
  } catch {
    /* */
  }

  // 5) Por confirmar próximos 30 días (preprogrammed sin confirmed_at)
  let pending_confirmation_30d = 0;
  try {
    const next30 = new Date();
    next30.setDate(next30.getDate() + 30);
    const next30Iso = next30.toISOString();
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "preprogrammed")
      .is("confirmed_at", null)
      .lte("scheduled_at", next30Iso);
    pending_confirmation_30d = count ?? 0;
  } catch {
    // Si la migración 20260525100000 aún no se ha aplicado (sin
    // confirmed_at) caemos a 0 — fail-soft.
  }

  return {
    overdue,
    unassigned_next_7d,
    low_nps_30d,
    active_contracts_without_job,
    pending_confirmation_30d,
  };
}
