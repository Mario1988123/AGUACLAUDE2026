import { Trophy, CheckCircle2, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import type { MyMilestones, MonthlyHistoryPoint } from "./milestones-actions";

function eur(n: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

const MONTH_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export function MilestonesCard({ data }: { data: MyMilestones }) {
  if (data.milestones.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Hitos del mes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            La empresa no tiene hitos configurados. Pídele al admin que los
            defina en Configuración → Puntos.
          </p>
        </CardContent>
      </Card>
    );
  }

  const reachedCount = data.milestones.filter((m) => m.reached).length;
  const nextNotReached = data.milestones.find((m) => !m.reached);
  const pointsToNext = nextNotReached
    ? Math.max(0, nextNotReached.threshold - data.current_month_points)
    : 0;
  const progressToNext = nextNotReached
    ? Math.min(
        100,
        Math.round((data.current_month_points * 100) / nextNotReached.threshold),
      )
    : 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Hitos del mes
          </span>
          <span className="text-sm font-bold tabular-nums">
            {reachedCount} / {data.milestones.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">Puntos del mes</div>
            <div className="text-2xl font-extrabold tabular-nums">
              {data.current_month_points.toLocaleString("es-ES")}
            </div>
          </div>
          {data.euros_per_point > 0 && (
            <div className="rounded-xl border-2 border-success/30 bg-success/5 p-3">
              <div className="text-xs text-success">
                Estimación comisión (€{data.euros_per_point.toFixed(2)}/punto)
              </div>
              <div className="text-2xl font-extrabold tabular-nums text-success">
                {eur(data.estimated_euros_month)}
              </div>
            </div>
          )}
        </div>

        {nextNotReached && (
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="text-xs text-muted-foreground">Siguiente hito</div>
                <div className="font-bold">
                  {nextNotReached.label} → +{nextNotReached.bonus_points} pts bonus
                </div>
              </div>
              <Badge variant="outline">
                Faltan {pointsToNext.toLocaleString("es-ES")} pts
              </Badge>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progressToNext}%` }}
              />
            </div>
          </div>
        )}

        <ul className="space-y-1.5">
          {data.milestones.map((m) => (
            <li
              key={m.threshold}
              className={`flex items-center justify-between gap-3 rounded-lg border p-2 text-sm ${
                m.reached ? "border-success/40 bg-success/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-2">
                {m.reached ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-bold">{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  ({m.threshold} pts)
                </span>
              </div>
              <Badge variant={m.reached ? "success" : "secondary"}>
                +{m.bonus_points}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PointsHistoryCard({ data }: { data: MonthlyHistoryPoint[] }) {
  if (data.length === 0) {
    return null;
  }
  const max = Math.max(...data.map((d) => d.total_points), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico últimos 12 meses</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 h-32">
          {data.map((d, i) => {
            const h = Math.max(2, (d.total_points / max) * 100);
            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${MONTH_SHORT[d.month - 1]}/${d.year}: ${d.total_points} pts`}
              >
                <div className="text-[10px] tabular-nums font-bold">
                  {d.total_points || ""}
                </div>
                <div
                  className="w-full bg-primary/70 rounded-t hover:bg-primary"
                  style={{ height: `${h}%` }}
                />
                <div className="text-[10px] text-muted-foreground">
                  {MONTH_SHORT[d.month - 1]}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
