import Link from "next/link";
import { Gift, AlertCircle } from "lucide-react";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export interface PendingTrial {
  id: string;
  reference_code: string | null;
  status: string;
  installed_at: string | null;
  expires_at: string | null;
  customer_name: string | null;
}

export async function getPendingTrials(): Promise<PendingTrial[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("free_trials")
    .select(
      "id, reference_code, status, installed_at, expires_at, customer_id, lead_id, assigned_user_id, customers(legal_name, trade_name, first_name, last_name, party_kind), leads(legal_name, trade_name, first_name, last_name, party_kind)",
    )
    .eq("company_id", session.company_id)
    .in("status", ["scheduled", "installed"])
    .is("deleted_at", null)
    .order("installed_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (visibleUserIds) q = q.in("assigned_user_id", visibleUserIds);
  const { data: trials } = await q;
  type T = {
    id: string;
    reference_code: string | null;
    status: string;
    installed_at: string | null;
    expires_at: string | null;
    customer_id: string | null;
    lead_id: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leads: any;
  };
  function nameOf(p: {
    party_kind?: "individual" | "company";
    trade_name?: string | null;
    legal_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null): string | null {
    if (!p) return null;
    return (
      p.trade_name ||
      p.legal_name ||
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
      null
    );
  }
  return ((trials ?? []) as T[]).map((t) => ({
    id: t.id,
    reference_code: t.reference_code,
    status: t.status,
    installed_at: t.installed_at,
    expires_at: t.expires_at,
    customer_name: nameOf(t.customers ?? t.leads),
  }));
}

export function PendingTrialsCard({ items }: { items: PendingTrial[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4" /> Pruebas gratuitas pendientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No hay pruebas pendientes de aceptar/rechazar.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-4 w-4" /> Pruebas gratuitas pendientes
          <Badge variant="warning">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/pruebas-gratuitas/${t.id}` as never}
                className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">
                    {t.customer_name ?? "Sin nombre"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.reference_code ?? `#${t.id.slice(0, 8)}`}
                    {t.expires_at && (
                      <> · caduca {new Date(t.expires_at).toLocaleDateString("es-ES")}</>
                    )}
                  </div>
                </div>
                <Badge variant={t.status === "installed" ? "warning" : "secondary"}>
                  {t.status === "installed" ? "Instalada" : "Agendada"}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export interface CriticalAlert {
  id: string;
  product_id: string;
  product_name: string;
  message: string;
  kind: string;
  severity: string;
}

export async function getCriticalStockAlerts(): Promise<CriticalAlert[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let alerts: Array<{
    id: string;
    product_id: string;
    message: string;
    kind: string;
    severity: string;
  }> = [];
  try {
    const { data } = await supabase
      .from("stock_alerts")
      .select("id, product_id, message, kind, severity, status")
      .eq("company_id", session.company_id)
      .eq("status", "active")
      .in("severity", ["critical", "warning"])
      .order("severity", { ascending: true })
      .limit(8);
    alerts = (data ?? []) as typeof alerts;
  } catch {
    return [];
  }
  if (alerts.length === 0) return [];
  const productIds = Array.from(new Set(alerts.map((a) => a.product_id)));
  const { data: prods } = await supabase
    .from("products")
    .select("id, name")
    .in("id", productIds);
  const nameMap = new Map(
    ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [
      p.id,
      p.name,
    ]),
  );
  return alerts.map((a) => ({
    ...a,
    product_name: nameMap.get(a.product_id) ?? "?",
  }));
}

export function CriticalStockAlertsCard({ items }: { items: CriticalAlert[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Alertas de stock
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-success">
            ✓ Stock controlado. Sin alertas críticas.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          Alertas de stock
          <Badge variant="destructive">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/productos/${a.product_id}` as never}
                className={`block rounded-xl border p-3 hover:bg-muted/30 ${
                  a.severity === "critical"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-warning/40 bg-warning/5"
                }`}
              >
                <div className="font-bold truncate">{a.product_name}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">
                  {a.message}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={"/almacenes" as never}
          className="mt-2 block text-center text-xs text-primary hover:underline"
        >
          Ver todas las alertas →
        </Link>
      </CardContent>
    </Card>
  );
}
