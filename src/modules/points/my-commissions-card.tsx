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
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Settings para euros_per_point
  let eurosPerPoint = 0;
  try {
    const { data: settings } = await admin
      .from("points_settings")
      .select("euros_per_point")
      .eq("company_id", session.company_id)
      .maybeSingle();
    eurosPerPoint = Number((settings as { euros_per_point: number } | null)?.euros_per_point ?? 0);
  } catch {
    /* */
  }

  // 2) Ciclo actual (status=open) o el más reciente
  let cycleId: string | null = null;
  let cycleLabel = "Ciclo actual";
  try {
    const { data: cycle } = await admin
      .from("points_cycles")
      .select("id, cycle_year, cycle_month, status")
      .eq("company_id", session.company_id)
      .order("cycle_year", { ascending: false })
      .order("cycle_month", { ascending: false })
      .limit(1)
      .maybeSingle();
    const c = cycle as
      | { id: string; cycle_year: number; cycle_month: number; status: string }
      | null;
    if (c) {
      cycleId = c.id;
      const months = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
      ];
      cycleLabel = `${months[c.cycle_month - 1]} ${c.cycle_year}`;
    }
  } catch {
    /* */
  }

  // 3) Puntos del usuario en el ciclo actual
  let currentPoints = 0;
  try {
    if (cycleId) {
      const { data: events } = await admin
        .from("points_events")
        .select("points")
        .eq("company_id", session.company_id)
        .eq("user_id", userId)
        .eq("cycle_id", cycleId);
      currentPoints = ((events ?? []) as Array<{ points: number }>).reduce(
        (s, e) => s + (e.points ?? 0),
        0,
      );
    } else {
      // Fallback: puntos del mes actual del usuario
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: events } = await admin
        .from("points_events")
        .select("points")
        .eq("company_id", session.company_id)
        .eq("user_id", userId)
        .gte("created_at", monthStart);
      currentPoints = ((events ?? []) as Array<{ points: number }>).reduce(
        (s, e) => s + (e.points ?? 0),
        0,
      );
    }
  } catch {
    /* */
  }

  // 4) Último ciclo cerrado del usuario
  let lastClosed: MyCommissionData["last_closed_cycle"] = null;
  try {
    const { data: closed } = await admin
      .from("points_cycle_users")
      .select("points, eur_cents, points_cycles!inner(cycle_year, cycle_month, status)")
      .eq("user_id", userId)
      .eq("points_cycles.status", "closed")
      .order("points_cycles(cycle_year)", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lc = closed as
      | {
          points: number;
          eur_cents: number;
          points_cycles: { cycle_year: number; cycle_month: number };
        }
      | null;
    if (lc) {
      const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      lastClosed = {
        label: `${months[lc.points_cycles.cycle_month - 1]} ${lc.points_cycles.cycle_year}`,
        points: lc.points,
        eur_cents: lc.eur_cents,
      };
    }
  } catch {
    /* tabla cycle_users puede no existir */
  }

  // 5) Total año: sumar puntos events del año en curso
  let totalYearEur = 0;
  try {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const { data: yearEvents } = await admin
      .from("points_events")
      .select("points")
      .eq("company_id", session.company_id)
      .eq("user_id", userId)
      .gte("created_at", yearStart);
    const yearPoints = ((yearEvents ?? []) as Array<{ points: number }>).reduce(
      (s, e) => s + (e.points ?? 0),
      0,
    );
    totalYearEur = Math.round(yearPoints * eurosPerPoint * 100);
  } catch {
    /* */
  }

  return {
    current_cycle_points: currentPoints,
    current_cycle_eur_cents: Math.round(currentPoints * eurosPerPoint * 100),
    current_cycle_label: cycleLabel,
    last_closed_cycle: lastClosed,
    ranking_in_company: null, // se podría calcular pero requiere más queries
    total_year_eur_cents: totalYearEur,
  };
}
