import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Clock, CircleDollarSign, AlertCircle } from "lucide-react";

export interface WalletAlerts {
  pending_validate_7d: number;
  cash_to_settle: number;
  payment_failures_30d: number;
  uninvoiced_count: number;
}

export function WalletSmartAlerts({ alerts }: { alerts: WalletAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.pending_validate_7d > 0)
    items.push({
      key: "pending",
      label: "Pendientes validar >7d",
      value: alerts.pending_validate_7d,
      icon: Clock,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/wallet?status=pending",
    });
  if (alerts.cash_to_settle > 0)
    items.push({
      key: "cash",
      label: "Efectivo sin liquidar",
      value: alerts.cash_to_settle,
      icon: CircleDollarSign,
      color: "border-emerald-300 bg-emerald-50 text-emerald-900",
      href: "/wallet?method=cash&status=pending_settlement",
    });
  if (alerts.payment_failures_30d > 0)
    items.push({
      key: "failures",
      label: "Devoluciones / rechazos último mes",
      value: alerts.payment_failures_30d,
      icon: AlertCircle,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/wallet?status=rejected",
    });
  if (alerts.uninvoiced_count > 0)
    items.push({
      key: "uninvoiced",
      label: "Cobrados sin facturar",
      value: alerts.uninvoiced_count,
      icon: AlertCircle,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/facturas",
    });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🧠 Atención cobros
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

export async function getWalletAlerts(): Promise<WalletAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: WalletAlerts = {
    pending_validate_7d: 0,
    cash_to_settle: 0,
    payment_failures_30d: 0,
    uninvoiced_count: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const past7 = new Date(now.getTime() - 7 * 86400000);
  const past30 = new Date(now.getTime() - 30 * 86400000);

  try {
    const { count } = await admin
      .from("wallet_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "pending")
      .lt("created_at", past7.toISOString());
    out.pending_validate_7d = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("wallet_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("method", "cash")
      .eq("status", "pending_settlement");
    out.cash_to_settle = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("wallet_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["rejected", "cancelled"])
      .gt("created_at", past30.toISOString());
    out.payment_failures_30d = count ?? 0;
  } catch {
    /* */
  }

  try {
    // Cobrados (collected/validated) sin invoice_id
    const { count } = await admin
      .from("wallet_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["collected", "validated"])
      .is("invoice_id", null)
      .not("customer_id", "is", null);
    out.uninvoiced_count = count ?? 0;
  } catch {
    /* */
  }

  return out;
}
