import { Card, CardContent } from "@/shared/ui/card";

export interface CustomerKPIs {
  total_revenue_ytd: number;
  total_revenue_all: number;
  active_contracts: number;
  installations_count: number;
  open_incidents: number;
  customer_since: string | null;
  churn_score: number | null;
  /** Meses restantes del contrato de alquiler/renting más cercano a vencer. */
  rental_months_left: number | null;
  /** Fecha del próximo mantenimiento agendado. */
  next_maintenance_at: string | null;
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
            Cliente desde
          </div>
          <div className="text-xl font-extrabold tabular-nums">
            {kpis.customer_since ? (
              <span>
                {new Date(kpis.customer_since).toLocaleDateString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            ) : (
              "—"
            )}
          </div>
          {ageMonths != null && (
            <div className="text-[10px] text-muted-foreground">
              {ageMonths < 12
                ? `hace ${ageMonths} m`
                : `hace ${Math.floor(ageMonths / 12)} a ${ageMonths % 12} m`}
            </div>
          )}
        </div>
        </div>

        {/* Línea adicional con info crítica del cliente */}
        {(kpis.rental_months_left != null || kpis.next_maintenance_at || kpis.open_incidents > 0) && (
          <div className="grid gap-3 sm:grid-cols-3 border-t pt-3">
            {kpis.rental_months_left != null && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Alquiler/Renting · restante
                </div>
                <div className="text-base font-extrabold text-amber-900 tabular-nums">
                  {kpis.rental_months_left} {kpis.rental_months_left === 1 ? "mes" : "meses"}
                </div>
              </div>
            )}
            {kpis.next_maintenance_at && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                  Próximo mantenimiento
                </div>
                <div className="text-base font-extrabold text-blue-900 tabular-nums">
                  {new Date(kpis.next_maintenance_at).toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
              </div>
            )}
            {kpis.open_incidents > 0 && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                  ⚠ Incidencias abiertas
                </div>
                <div className="text-base font-extrabold text-red-900 tabular-nums">
                  {kpis.open_incidents}
                </div>
              </div>
            )}
          </div>
        )}
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
    rental_months_left: null,
    next_maintenance_at: null,
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

  // Meses restantes de alquiler/renting activo. Tomamos el más próximo a
  // vencer (signed_at + duration_months - now).
  try {
    const { data: rentals } = await admin
      .from("contracts")
      .select("plan_type, status, signed_at, duration_months, service_start_date")
      .eq("customer_id", customerId)
      .in("plan_type", ["rental", "renting"])
      .in("status", ["signed", "active"])
      .is("deleted_at", null)
      .is("paused_at", null);
    type R = {
      plan_type: "rental" | "renting";
      status: string;
      signed_at: string | null;
      duration_months: number | null;
      service_start_date: string | null;
    };
    let minLeft: number | null = null;
    const now = new Date();
    for (const r of ((rentals ?? []) as R[])) {
      if (!r.duration_months) continue;
      const start = new Date(r.service_start_date ?? r.signed_at ?? new Date());
      const end = new Date(start);
      end.setMonth(end.getMonth() + r.duration_months);
      const monthsLeft = Math.max(
        0,
        Math.round(
          (end.getTime() - now.getTime()) / (30 * 86400000),
        ),
      );
      if (minLeft == null || monthsLeft < minLeft) minLeft = monthsLeft;
    }
    out.rental_months_left = minLeft;
  } catch {
    /* fail-soft: paused_at puede no existir si migración no aplicada */
    try {
      const { data: rentals } = await admin
        .from("contracts")
        .select("plan_type, status, signed_at, duration_months")
        .eq("customer_id", customerId)
        .in("plan_type", ["rental", "renting"])
        .in("status", ["signed", "active"])
        .is("deleted_at", null);
      type R2 = {
        plan_type: string;
        signed_at: string | null;
        duration_months: number | null;
      };
      const now = new Date();
      let minLeft: number | null = null;
      for (const r of ((rentals ?? []) as R2[])) {
        if (!r.duration_months || !r.signed_at) continue;
        const end = new Date(r.signed_at);
        end.setMonth(end.getMonth() + r.duration_months);
        const monthsLeft = Math.max(
          0,
          Math.round((end.getTime() - now.getTime()) / (30 * 86400000)),
        );
        if (minLeft == null || monthsLeft < minLeft) minLeft = monthsLeft;
      }
      out.rental_months_left = minLeft;
    } catch {
      /* */
    }
  }

  // Próximo mantenimiento scheduled.
  try {
    const { data: m } = await admin
      .from("maintenance_jobs")
      .select("scheduled_at, status")
      .eq("customer_id", customerId)
      .in("status", ["scheduled", "in_progress"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (m) {
      out.next_maintenance_at = (m as { scheduled_at: string | null }).scheduled_at;
    }
  } catch {
    /* */
  }

  return out;
}
