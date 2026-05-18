import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  Receipt,
  AlertOctagon,
  FileX,
  Settings,
} from "lucide-react";

export interface InvoiceAlerts {
  overdue_30d: number;
  draft_old: number;     // borradores > 7d sin emitir
  no_series_configured: boolean;
  unpaid_total_cents: number;
}

export function InvoiceSmartAlerts({ alerts }: { alerts: InvoiceAlerts }) {
  const items: Array<{
    key: string;
    label: string;
    value: string | number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    href: string;
  }> = [];
  if (alerts.overdue_30d > 0)
    items.push({
      key: "overdue",
      label: "Vencidas >30d sin cobrar",
      value: alerts.overdue_30d,
      icon: AlertOctagon,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/facturas?status=overdue",
    });
  if (alerts.draft_old > 0)
    items.push({
      key: "drafts",
      label: "Borradores antiguos sin emitir",
      value: alerts.draft_old,
      icon: FileX,
      color: "border-amber-300 bg-amber-50 text-amber-900",
      href: "/facturas?status=draft",
    });
  if (alerts.no_series_configured)
    items.push({
      key: "series",
      label: "Sin serie de facturación",
      value: "⚠",
      icon: Settings,
      color: "border-red-300 bg-red-50 text-red-900",
      href: "/configuracion/facturacion",
    });
  if (alerts.unpaid_total_cents > 0)
    items.push({
      key: "unpaid",
      label: "Pendiente cobro total",
      value: new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
      }).format(alerts.unpaid_total_cents / 100),
      icon: Receipt,
      color: "border-blue-300 bg-blue-50 text-blue-900",
      href: "/facturas",
    });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🧠 Atención facturación
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
                  <div className="text-xl font-extrabold tabular-nums">{it.value}</div>
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

export async function getInvoiceAlerts(): Promise<InvoiceAlerts> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  const out: InvoiceAlerts = {
    overdue_30d: 0,
    draft_old: 0,
    no_series_configured: false,
    unpaid_total_cents: 0,
  };
  if (!session.company_id) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 86400000);
  const past7 = new Date(now.getTime() - 7 * 86400000);

  // 1) Vencidas >30d: emitidas con due_date < hace 30d y pending_cents > 0
  try {
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .in("status", ["issued", "overdue"])
      .lt("due_date", past30.toISOString().slice(0, 10))
      .gt("pending_cents", 0)
      .is("deleted_at", null);
    out.overdue_30d = count ?? 0;
  } catch {
    /* */
  }

  // 2) Borradores antiguos
  try {
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("status", "draft")
      .lt("created_at", past7.toISOString())
      .is("deleted_at", null);
    out.draft_old = count ?? 0;
  } catch {
    /* */
  }

  // 3) Series configuradas
  try {
    const { count } = await admin
      .from("invoice_series")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("is_active", true);
    out.no_series_configured = (count ?? 0) === 0;
  } catch {
    /* */
  }

  // 4) Pendiente cobro total
  try {
    const { data: pending } = await admin
      .from("invoices")
      .select("pending_cents")
      .eq("company_id", session.company_id)
      .gt("pending_cents", 0)
      .is("deleted_at", null);
    out.unpaid_total_cents = ((pending ?? []) as Array<{ pending_cents: number }>).reduce(
      (s, r) => s + (r.pending_cents ?? 0),
      0,
    );
  } catch {
    /* */
  }

  return out;
}
