import { Card, CardContent } from "@/shared/ui/card";

export interface CustomerKPIs {
  total_revenue_ytd: number;
  total_revenue_all: number;
  active_contracts: number;
  installations_count: number;
  open_incidents: number;
  customer_since: string | null;
  churn_score: number | null;
}

function churnColor(score: number): { bg: string; text: string; label: string } {
  if (score >= 60) return { bg: "bg-red-100", text: "text-red-900", label: "Alto riesgo" };
  if (score >= 30) return { bg: "bg-amber-100", text: "text-amber-900", label: "Riesgo medio" };
  return { bg: "bg-emerald-100", text: "text-emerald-900", label: "Bajo riesgo" };
}

export function CustomerKPIHeader({ kpis }: { kpis: CustomerKPIs }) {
  const eur = (c: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(c / 100);

  const ageMonths = kpis.customer_since
    ? Math.floor(
        (Date.now() - new Date(kpis.customer_since).getTime()) / (30 * 86400000),
      )
    : null;

  const churn = kpis.churn_score != null ? churnColor(kpis.churn_score) : null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 pt-6">
        {churn && (
          <div
            className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold ${churn.bg} ${churn.text}`}
          >
            <span>Riesgo de churn · {churn.label}</span>
            <span className="text-2xl tabular-nums">{kpis.churn_score}/100</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Facturado año
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {eur(kpis.total_revenue_ytd)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Facturado total
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {eur(kpis.total_revenue_all)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Contratos activos
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {kpis.active_contracts}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Instalaciones
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {kpis.installations_count}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {kpis.open_incidents > 0 ? "⚠ Incidencias abiertas" : "Cliente desde"}
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {kpis.open_incidents > 0 ? (
              <span className="text-red-700">{kpis.open_incidents}</span>
            ) : ageMonths != null ? (
              <span>
                {ageMonths < 12
                  ? `${ageMonths} m`
                  : `${Math.floor(ageMonths / 12)} a ${ageMonths % 12} m`}
              </span>
            ) : (
              "—"
            )}
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}

export async function getCustomerKPIs(customerId: string): Promise<CustomerKPIs> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const out: CustomerKPIs = {
    total_revenue_ytd: 0,
    total_revenue_all: 0,
    active_contracts: 0,
    installations_count: 0,
    open_incidents: 0,
    customer_since: null,
    churn_score: null,
  };
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

  // Facturado año actual + total
  try {
    const { data: invs } = await admin
      .from("invoices")
      .select("total_cents, issued_at")
      .eq("customer_id", customerId)
      .in("status", ["issued", "overdue", "paid"])
      .is("deleted_at", null);
    for (const inv of ((invs ?? []) as Array<{ total_cents: number; issued_at: string | null }>)) {
      out.total_revenue_all += inv.total_cents ?? 0;
      if (inv.issued_at && inv.issued_at >= yearStart) {
        out.total_revenue_ytd += inv.total_cents ?? 0;
      }
    }
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .in("status", ["active", "signed"])
      .is("deleted_at", null);
    out.active_contracts = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("status", "completed")
      .is("deleted_at", null);
    out.installations_count = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { count } = await admin
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .in("status", ["open", "assigned", "in_progress"]);
    out.open_incidents = count ?? 0;
  } catch {
    /* */
  }

  try {
    const { data: customer } = await admin
      .from("customers")
      .select("created_at, churn_score")
      .eq("id", customerId)
      .maybeSingle();
    const c = customer as { created_at: string | null; churn_score: number | null } | null;
    out.customer_since = c?.created_at ?? null;
    out.churn_score = c?.churn_score ?? null;
  } catch {
    // Si churn_score no existe todavía (migración pendiente), reintentar sin él
    try {
      const { data: customer } = await admin
        .from("customers")
        .select("created_at")
        .eq("id", customerId)
        .maybeSingle();
      out.customer_since = (customer as { created_at: string | null } | null)?.created_at ?? null;
    } catch {
      /* */
    }
  }

  return out;
}
