import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Clock, AlertCircle, Hourglass, FileWarning } from "lucide-react";

export interface ProposalAlerts {
  pending_approval: number;
  sent_no_response_7d: number;
  expiring_soon: number;
  high_amount_pending: number;
}

export function ProposalSmartAlerts({ alerts }: { alerts: ProposalAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.pending_approval > 0)
    items.push({
      key: "approval",
      label: "Pendientes aprobación dirección",
      value: alerts.pending_approval,
      icon: AlertCircle,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/propuestas?status=pending_approval",
    });
  if (alerts.sent_no_response_7d > 0)
    items.push({
      key: "stale",
      label: "Enviadas hace >7d sin respuesta",
      value: alerts.sent_no_response_7d,
      icon: Clock,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/propuestas?status=sent",
    });
  if (alerts.expiring_soon > 0)
    items.push({
      key: "expiring",
      label: "Caducan en <7d",
      value: alerts.expiring_soon,
      icon: Hourglass,
      color: "border-orange-300 bg-orange-50 text-orange-900",
      href: "/propuestas?status=sent",
    });
  if (alerts.high_amount_pending > 0)
    items.push({
      key: "high",
      label: "Importe alto pendiente respuesta",
      value: alerts.high_amount_pending,
      icon: FileWarning,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/propuestas?status=sent",
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

const VALIDITY_DAYS = 30;
const HIGH_AMOUNT_CENTS = 200000; // 2000 €

export async function getProposalAlerts(): Promise<ProposalAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: ProposalAlerts = {
    pending_approval: 0,
    sent_no_response_7d: 0,
    expiring_soon: 0,
    high_amount_pending: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const past7 = new Date(now.getTime() - 7 * 86400000);
  const next7 = new Date(now.getTime() + 7 * 86400000);
  const validityCutoff = new Date(now.getTime() - VALIDITY_DAYS * 86400000);

  try {
    const { count } = await admin
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "pending_approval")
      .is("deleted_at", null);
    out.pending_approval = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "sent")
      .is("deleted_at", null)
      .lt("sent_at", past7.toISOString());
    out.sent_no_response_7d = count ?? 0;
  } catch {
    /* */
  }

  // Próximas a caducar: enviadas hace entre (VALIDITY-7) y VALIDITY días
  try {
    const expiryStart = new Date(now.getTime() - VALIDITY_DAYS * 86400000);
    const expiryEnd = new Date(now.getTime() - (VALIDITY_DAYS - 7) * 86400000);
    const { count } = await admin
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "sent")
      .is("deleted_at", null)
      .gte("sent_at", expiryStart.toISOString())
      .lte("sent_at", expiryEnd.toISOString());
    out.expiring_soon = count ?? 0;
  } catch {
    /* */
  }

  // Importe alto pendiente
  try {
    const { count } = await admin
      .from("proposals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "sent")
      .is("deleted_at", null)
      .gte("total_cash_cents", HIGH_AMOUNT_CENTS);
    out.high_amount_pending = count ?? 0;
  } catch {
    /* */
  }

  // dummy referencias para evitar warnings
  void next7;
  void validityCutoff;

  return out;
}
