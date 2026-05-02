import { Badge } from "@/shared/ui/badge";
import type { ObjectiveAchievement } from "./achievement-actions";

const METRIC_LABEL: Record<string, string> = {
  cash_total: "Contado",
  renting_total: "Renting",
  rental_total: "Alquiler",
  financier_total: "Financiera",
  units: "Unidades",
  any_total: "Total facturado",
};

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function pctColor(pct: number | null): string {
  if (pct == null) return "bg-muted";
  if (pct >= 100) return "bg-success";
  if (pct >= 75) return "bg-primary";
  if (pct >= 50) return "bg-warning";
  return "bg-destructive";
}

export function ObjectivesAchievementList({ data }: { data: ObjectiveAchievement[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay objetivos definidos. Configura desde Configuración → Objetivos mensuales.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {data.map((o) => {
        const showAmount = o.target_amount_cents != null && o.target_amount_cents > 0;
        const showUnits = o.target_units != null && o.target_units > 0;
        return (
          <div key={o.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{o.scope_label}</div>
                <div className="text-xs text-muted-foreground">
                  {METRIC_LABEL[o.metric_kind] ?? o.metric_kind}
                </div>
              </div>
              <Badge variant={o.scope_type === "department" ? "outline" : "secondary"}>
                {o.scope_type === "department" ? "Departamento" : "Individual"}
              </Badge>
            </div>

            {showAmount && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Importe</span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(o.actual_amount_cents)} / {formatCents(o.target_amount_cents)}
                    {o.percent_amount != null && (
                      <span className="ml-2 text-muted-foreground">({o.percent_amount}%)</span>
                    )}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${pctColor(o.percent_amount)} transition-all`}
                    style={{ width: `${Math.min(o.percent_amount ?? 0, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {showUnits && (
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Unidades</span>
                  <span className="font-semibold tabular-nums">
                    {o.actual_units} / {o.target_units}
                    {o.percent_units != null && (
                      <span className="ml-2 text-muted-foreground">({o.percent_units}%)</span>
                    )}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${pctColor(o.percent_units)} transition-all`}
                    style={{ width: `${Math.min(o.percent_units ?? 0, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
