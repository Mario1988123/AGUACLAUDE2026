import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Flame, Snowflake, Thermometer, Calendar, Gift } from "lucide-react";

export interface LeadAlerts {
  hot_uncontacted_24h: number;   // new sin event lead.contacted >24h
  no_activity_7d: number;        // contactado pero sin nuevo event >7d
  appointments_today: number;
  appointments_tomorrow: number;
  trial_expiring_no_proposal: number; // pruebas activas <7d sin propuesta
}

export function LeadSmartAlerts({ alerts }: { alerts: LeadAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.hot_uncontacted_24h > 0)
    items.push({
      key: "hot",
      label: "Nuevos sin contactar >24h",
      value: alerts.hot_uncontacted_24h,
      icon: Flame,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/leads?status=new",
    });
  if (alerts.appointments_today > 0)
    items.push({
      key: "today",
      label: "Citas hoy",
      value: alerts.appointments_today,
      icon: Calendar,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      href: "/leads?status=appointment_scheduled",
    });
  if (alerts.appointments_tomorrow > 0)
    items.push({
      key: "tomorrow",
      label: "Citas mañana",
      value: alerts.appointments_tomorrow,
      icon: Calendar,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/leads?status=appointment_scheduled",
    });
  if (alerts.no_activity_7d > 0)
    items.push({
      key: "stale",
      label: "Sin actividad >7d",
      value: alerts.no_activity_7d,
      icon: Snowflake,
      color: "border-slate-300 bg-slate-50 text-slate-900",
      href: "/leads?status=contacted",
    });
  if (alerts.trial_expiring_no_proposal > 0)
    items.push({
      key: "trial",
      label: "Prueba activa sin propuesta",
      value: alerts.trial_expiring_no_proposal,
      icon: Gift,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/pruebas-gratuitas",
    });

  if (items.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Pipeline al día. Sin leads sin contactar ni pruebas a punto de
          caducar.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="h-5 w-5" />
          Pulso del pipeline
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

export async function getLeadAlerts(userId: string | null): Promise<LeadAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: LeadAlerts = {
    hot_uncontacted_24h: 0,
    no_activity_7d: 0,
    appointments_today: 0,
    appointments_tomorrow: 0,
    trial_expiring_no_proposal: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600000);
  const past7 = new Date(now.getTime() - 7 * 86400000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const tomorrowStart = new Date(todayEnd.getTime() + 1000);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400000);

  // 1) Nuevos sin contactar >24h
  try {
    let q = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "new")
      .is("deleted_at", null)
      .lt("created_at", yesterday.toISOString());
    if (userId) q = q.eq("assigned_user_id", userId);
    const { count } = await q;
    out.hot_uncontacted_24h = count ?? 0;
  } catch {
    /* */
  }

  // 2) Contactado sin movimiento >7d (last_event_at sería ideal — usamos updated_at)
  try {
    let q = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "contacted")
      .is("deleted_at", null)
      .lt("updated_at", past7.toISOString());
    if (userId) q = q.eq("assigned_user_id", userId);
    const { count } = await q;
    out.no_activity_7d = count ?? 0;
  } catch {
    /* */
  }

  // 3+4) Citas hoy / mañana (status appointment_scheduled con appointment_at en rango)
  try {
    let q1 = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "appointment_scheduled")
      .is("deleted_at", null)
      .gte("appointment_at", todayStart.toISOString())
      .lte("appointment_at", todayEnd.toISOString());
    if (userId) q1 = q1.eq("assigned_user_id", userId);
    const { count: c1 } = await q1;
    out.appointments_today = c1 ?? 0;

    let q2 = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "appointment_scheduled")
      .is("deleted_at", null)
      .gte("appointment_at", tomorrowStart.toISOString())
      .lte("appointment_at", tomorrowEnd.toISOString());
    if (userId) q2 = q2.eq("assigned_user_id", userId);
    const { count: c2 } = await q2;
    out.appointments_tomorrow = c2 ?? 0;
  } catch {
    /* */
  }

  // 5) Pruebas gratuitas activas sin propuesta aceptada
  try {
    const next7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: trials } = await admin
      .from("free_trials")
      .select("id, lead_id, expires_at")
      .eq("company_id", session.company_id)
      .in("status", ["installed"])
      .lte("expires_at", next7);
    const trialList = (trials ?? []) as Array<{ id: string; lead_id: string | null }>;
    if (trialList.length > 0) {
      const leadIds = trialList.map((t) => t.lead_id).filter((v): v is string => !!v);
      let with_proposal_accepted = new Set<string>();
      if (leadIds.length > 0) {
        const { data: props } = await admin
          .from("proposals")
          .select("lead_id, status")
          .in("lead_id", leadIds)
          .eq("status", "accepted");
        with_proposal_accepted = new Set(
          ((props ?? []) as Array<{ lead_id: string | null }>)
            .map((p) => p.lead_id)
            .filter((v): v is string => !!v),
        );
      }
      out.trial_expiring_no_proposal = trialList.filter(
        (t) => !t.lead_id || !with_proposal_accepted.has(t.lead_id),
      ).length;
    }
  } catch {
    /* */
  }

  return out;
}
