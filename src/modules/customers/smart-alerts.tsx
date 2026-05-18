import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  AlertTriangle,
  TrendingDown,
  Wrench,
  FileWarning,
  Copy,
  ShieldOff,
} from "lucide-react";

export interface CustomerAlerts {
  inactive_with_equipment: number;
  no_active_contract_with_equipment: number;
  overdue_maintenance: number;
  duplicates: number;
  missing_rgpd: number;
  payment_failed_last_month: number;
}

export function CustomerSmartAlerts({ alerts }: { alerts: CustomerAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.inactive_with_equipment > 0)
    items.push({
      key: "inactive",
      label: "Inactivos >180d con equipo",
      value: alerts.inactive_with_equipment,
      icon: TrendingDown,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/clientes",
    });
  if (alerts.overdue_maintenance > 0)
    items.push({
      key: "maint",
      label: "Con mantenimiento vencido",
      value: alerts.overdue_maintenance,
      icon: Wrench,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/mantenimientos?status=scheduled&period=past",
    });
  if (alerts.payment_failed_last_month > 0)
    items.push({
      key: "payment",
      label: "Pagos fallados último mes",
      value: alerts.payment_failed_last_month,
      icon: FileWarning,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/wallet",
    });
  if (alerts.no_active_contract_with_equipment > 0)
    items.push({
      key: "no_contract",
      label: "Equipo sin contrato activo",
      value: alerts.no_active_contract_with_equipment,
      icon: AlertTriangle,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/clientes",
    });
  if (alerts.duplicates > 0)
    items.push({
      key: "dup",
      label: "Duplicados detectados",
      value: alerts.duplicates,
      icon: Copy,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/clientes/duplicados",
    });
  if (alerts.missing_rgpd > 0)
    items.push({
      key: "rgpd",
      label: "Sin consentimiento RGPD",
      value: alerts.missing_rgpd,
      icon: ShieldOff,
      color: "border-purple-300 bg-purple-50 text-purple-900",
      href: "/clientes",
    });

  if (items.length === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="py-4 text-sm text-emerald-900">
          ✓ Cartera sana. Sin clientes en riesgo, sin duplicados.
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

export async function getCustomerAlerts(): Promise<CustomerAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: CustomerAlerts = {
    inactive_with_equipment: 0,
    no_active_contract_with_equipment: 0,
    overdue_maintenance: 0,
    duplicates: 0,
    missing_rgpd: 0,
    payment_failed_last_month: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const past180 = new Date();
  past180.setDate(past180.getDate() - 180);
  const past180Iso = past180.toISOString();
  const past30 = new Date();
  past30.setDate(past30.getDate() - 30);
  const past30Iso = past30.toISOString();
  const todayIso = new Date().toISOString();

  // 1) Equipo activo (customer_equipment status=active) + sin actividad >180d
  try {
    const { data: actives } = await admin
      .from("customer_equipment")
      .select("customer_id")
      .eq("company_id", session.company_id)
      .eq("status", "active");
    const customerIds = Array.from(
      new Set(((actives ?? []) as Array<{ customer_id: string }>).map((r) => r.customer_id)),
    );
    if (customerIds.length > 0) {
      const { data: recentEvents } = await admin
        .from("events")
        .select("subject_id")
        .eq("subject_type", "customer")
        .eq("company_id", session.company_id)
        .gt("created_at", past180Iso)
        .in("subject_id", customerIds);
      const recentSet = new Set(
        ((recentEvents ?? []) as Array<{ subject_id: string }>).map((e) => e.subject_id),
      );
      out.inactive_with_equipment = customerIds.filter((id) => !recentSet.has(id)).length;
    }
  } catch {
    /* */
  }

  // 2) Mantenimientos vencidos
  try {
    const { data: jobs } = await admin
      .from("maintenance_jobs")
      .select("customer_id")
      .eq("company_id", session.company_id)
      .eq("status", "scheduled")
      .lt("scheduled_at", todayIso);
    out.overdue_maintenance = new Set(
      ((jobs ?? []) as Array<{ customer_id: string }>).map((r) => r.customer_id),
    ).size;
  } catch {
    /* */
  }

  // 3) Wallet con devolución / rejected último mes
  try {
    const { data: failed } = await admin
      .from("wallet_entries")
      .select("customer_id")
      .eq("company_id", session.company_id)
      .in("status", ["rejected", "cancelled"])
      .gt("created_at", past30Iso);
    out.payment_failed_last_month = new Set(
      ((failed ?? []) as Array<{ customer_id: string | null }>)
        .map((r) => r.customer_id)
        .filter((v): v is string => !!v),
    ).size;
  } catch {
    /* */
  }

  // 4) Cliente con equipo pero sin contrato activo
  try {
    const { data: actives } = await admin
      .from("customer_equipment")
      .select("customer_id")
      .eq("company_id", session.company_id)
      .eq("status", "active");
    const customerIds = Array.from(
      new Set(((actives ?? []) as Array<{ customer_id: string }>).map((r) => r.customer_id)),
    );
    if (customerIds.length > 0) {
      const { data: contracts } = await admin
        .from("contracts")
        .select("customer_id")
        .eq("company_id", session.company_id)
        .in("status", ["signed", "active"])
        .in("customer_id", customerIds)
        .is("deleted_at", null);
      const haveContract = new Set(
        ((contracts ?? []) as Array<{ customer_id: string }>).map((c) => c.customer_id),
      );
      out.no_active_contract_with_equipment = customerIds.filter((id) => !haveContract.has(id))
        .length;
    }
  } catch {
    /* */
  }

  // 5) Duplicados — defensivo si la tabla customer_duplicates existe
  try {
    const { count } = await admin
      .from("customer_duplicates")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "pending");
    out.duplicates = count ?? 0;
  } catch {
    /* */
  }

  // 6) Sin RGPD firmado
  try {
    const { count } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .is("consent_rgpd_at", null);
    out.missing_rgpd = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
