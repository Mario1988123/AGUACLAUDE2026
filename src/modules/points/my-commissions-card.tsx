import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Trophy, TrendingUp, Calendar } from "lucide-react";

export interface MyCommissionData {
  current_cycle_points: number;
  current_cycle_eur_cents: number;
  current_cycle_label: string;
  last_closed_cycle: {
    label: string;
    points: number;
    eur_cents: number;
  } | null;
  ranking_in_company: number | null;
  total_year_eur_cents: number;
}

export function MyCommissionsCard({ data }: { data: MyCommissionData }) {
  const eur = (c: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(c / 100);

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          Mis comisiones · {data.current_cycle_label}
          {data.ranking_in_company != null && data.ranking_in_company <= 3 && (
            <Badge variant="warning">🥇 Top {data.ranking_in_company}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Puntos este ciclo
            </div>
            <div className="text-3xl font-extrabold tabular-nums text-primary">
              {data.current_cycle_points}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Equivalente €
            </div>
            <div className="text-3xl font-extrabold tabular-nums">
              {eur(data.current_cycle_eur_cents)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Total año
            </div>
            <div className="text-3xl font-extrabold tabular-nums">
              {eur(data.total_year_eur_cents)}
            </div>
          </div>
          {data.last_closed_cycle && (
            <div className="rounded-xl border bg-card p-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Calendar className="mr-1 inline h-3 w-3" /> Último ciclo cerrado
              </div>
              <div className="mt-1 text-sm">
                <strong>{data.last_closed_cycle.label}</strong>
              </div>
              <div className="text-xs tabular-nums">
                {data.last_closed_cycle.points} pts ·{" "}
                {eur(data.last_closed_cycle.eur_cents)}
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Las comisiones son <strong>informativas</strong>. El cierre del ciclo
          y el pago efectivo lo gestiona admin manualmente desde nómina.{" "}
          <Link href="/eventos?subject_type=points_event" className="font-bold underline">
            Ver detalle de puntos
          </Link>
          .
        </div>
      </CardContent>
    </Card>
  );
}

export async function getMyCommissionData(userId: string): Promise<MyCommissionData | null> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const { getPointsSettings } = await import("./award");
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const companyId = session.company_id;

  // Esta tarjeta consultaba points_settings, points_events y points_cycle_users
  // como si fueran tablas. No existen y nunca existieron: los puntos viven en
  // `points_ledger`, la configuración en `company_settings.points_settings`
  // (jsonb) y el cierre por usuario se calcula, no se guarda. Resultado: la
  // tarjeta enseñaba ceros a todo el mundo. Ahora usa las mismas fuentes que
  // getCycleDetail() en cycles-actions.ts.

  const settings = await getPointsSettings(companyId);
  const eurosPerPoint = settings.euros_per_point ?? 0;
  const toCents = (points: number) => Math.round(points * eurosPerPoint * 100);

  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  type Cycle = {
    id: string;
    cycle_year: number;
    cycle_month: number;
    cycle_start_at: string;
    cycle_end_at: string;
    status: string;
  };

  /** Puntos netos del usuario en un ciclo: ledger del rango + ajustes. */
  async function netPointsInCycle(cycle: Cycle): Promise<number> {
    const { data: ledger } = await admin
      .from("points_ledger")
      .select("points")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .gte("awarded_at", cycle.cycle_start_at)
      .lt("awarded_at", cycle.cycle_end_at);
    const base = ((ledger ?? []) as Array<{ points: number }>).reduce(
      (s, r) => s + (r.points ?? 0),
      0,
    );
    const { data: adj } = await admin
      .from("points_cycle_adjustments")
      .select("delta_points")
      .eq("company_id", companyId)
      .eq("cycle_id", cycle.id)
      .eq("user_id", userId);
    const delta = ((adj ?? []) as Array<{ delta_points: number }>).reduce(
      (s, r) => s + (r.delta_points ?? 0),
      0,
    );
    return base + delta;
  }

  const cycleCols =
    "id, cycle_year, cycle_month, cycle_start_at, cycle_end_at, status";

  // 1) Ciclo vigente: el abierto y, si no hay, el más reciente.
  const { data: openRow } = await admin
    .from("points_cycles")
    .select(cycleCols)
    .eq("company_id", companyId)
    .eq("status", "open")
    .order("cycle_year", { ascending: false })
    .order("cycle_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  let current = openRow as Cycle | null;
  if (!current) {
    const { data: anyRow } = await admin
      .from("points_cycles")
      .select(cycleCols)
      .eq("company_id", companyId)
      .order("cycle_year", { ascending: false })
      .order("cycle_month", { ascending: false })
      .limit(1)
      .maybeSingle();
    current = anyRow as Cycle | null;
  }

  let currentPoints = 0;
  let cycleLabel = "Ciclo actual";
  if (current) {
    currentPoints = await netPointsInCycle(current);
    cycleLabel = `${MESES[current.cycle_month - 1] ?? ""} ${current.cycle_year}`;
  } else {
    // Sin ciclos creados todavía: el mes natural en curso.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data: ledger } = await admin
      .from("points_ledger")
      .select("points")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .gte("awarded_at", monthStart);
    currentPoints = ((ledger ?? []) as Array<{ points: number }>).reduce(
      (s, r) => s + (r.points ?? 0),
      0,
    );
    cycleLabel = `${MESES[now.getMonth()] ?? ""} ${now.getFullYear()}`;
  }

  // 2) Último ciclo cerrado, calculado igual (no hay tabla de snapshot por usuario).
  let lastClosed: MyCommissionData["last_closed_cycle"] = null;
  const { data: closedRow } = await admin
    .from("points_cycles")
    .select(cycleCols)
    .eq("company_id", companyId)
    .eq("status", "closed")
    .order("cycle_year", { ascending: false })
    .order("cycle_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  const closed = closedRow as Cycle | null;
  if (closed) {
    const pts = await netPointsInCycle(closed);
    const MESES_CORTO = [
      "Ene", "Feb", "Mar", "Abr", "May", "Jun",
      "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
    ];
    lastClosed = {
      label: `${MESES_CORTO[closed.cycle_month - 1] ?? ""} ${closed.cycle_year}`,
      points: pts,
      eur_cents: toCents(pts),
    };
  }

  // 3) Total del año en curso (por fecha de concesión).
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const { data: yearLedger } = await admin
    .from("points_ledger")
    .select("points")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .gte("awarded_at", yearStart);
  const yearPoints = ((yearLedger ?? []) as Array<{ points: number }>).reduce(
    (s, r) => s + (r.points ?? 0),
    0,
  );

  return {
    current_cycle_points: currentPoints,
    current_cycle_eur_cents: toCents(currentPoints),
    current_cycle_label: cycleLabel,
    last_closed_cycle: lastClosed,
    ranking_in_company: null,
    total_year_eur_cents: toCents(yearPoints),
  };
}
