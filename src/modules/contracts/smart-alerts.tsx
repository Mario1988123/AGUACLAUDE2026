import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  FileCheck,
  CalendarOff,
  Banknote,
  XCircle,
} from "lucide-react";

export interface ContractAlerts {
  signed_pending_validate: number;
  signed_no_installation: number;
  renting_no_financier: number;
  cancelled_this_month: number;
}

export function ContractSmartAlerts({ alerts }: { alerts: ContractAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.signed_pending_validate > 0)
    items.push({
      key: "validate",
      label: "Firmados pendientes de validar",
      value: alerts.signed_pending_validate,
      icon: FileCheck,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/contratos?status=signed",
    });
  if (alerts.signed_no_installation > 0)
    items.push({
      key: "no_install",
      label: "Firmados sin instalación agendada",
      value: alerts.signed_no_installation,
      icon: CalendarOff,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/contratos?status=signed",
    });
  if (alerts.renting_no_financier > 0)
    items.push({
      key: "no_financier",
      label: "Renting sin financiera asignada",
      value: alerts.renting_no_financier,
      icon: Banknote,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/contratos?plan=renting&missing_financier=1",
    });
  if (alerts.cancelled_this_month > 0)
    items.push({
      key: "cancelled",
      label: "Cancelados este mes (churn)",
      value: alerts.cancelled_this_month,
      icon: XCircle,
      color: "border-slate-300 bg-slate-50 text-slate-900",
      href: "/contratos?status=cancelled",
    });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🧠 Atención requerida
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

export async function getContractAlerts(): Promise<ContractAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: ContractAlerts = {
    signed_pending_validate: 0,
    signed_no_installation: 0,
    renting_no_financier: 0,
    cancelled_this_month: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // 1) signed sin validated_at
  try {
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "signed")
      .is("validated_at", null)
      .is("deleted_at", null);
    out.signed_pending_validate = count ?? 0;
  } catch {
    /* */
  }

  // 2) signed sin instalación
  try {
    const { data: signed } = await admin
      .from("contracts")
      .select("id")
      .eq("company_id", session.company_id)
      .in("status", ["signed", "active"])
      .is("deleted_at", null);
    const ids = ((signed ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (ids.length > 0) {
      const { data: insts } = await admin
        .from("installations")
        .select("contract_id")
        .in("contract_id", ids)
        .is("deleted_at", null);
      const withInst = new Set(
        ((insts ?? []) as Array<{ contract_id: string | null }>)
          .map((i) => i.contract_id)
          .filter((v): v is string => !!v),
      );
      out.signed_no_installation = ids.filter((id) => !withInst.has(id)).length;
    }
  } catch {
    /* */
  }

  // 3) Renting sin financiera. SOLO renting — el alquiler no usa
  // financiera (cobramos la cuota directamente al cliente).
  try {
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["signed", "active"])
      .eq("plan_type", "renting")
      .is("financier_id", null)
      .is("deleted_at", null);
    out.renting_no_financier = count ?? 0;
  } catch {
    /* tabla puede no tener financier_id si la migración no está */
  }

  // 4) Cancelados este mes
  try {
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "cancelled")
      .gte("cancelled_at", monthStart);
    out.cancelled_this_month = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
