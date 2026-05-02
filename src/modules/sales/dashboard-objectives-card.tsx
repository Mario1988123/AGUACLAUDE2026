import { Target, Users } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { ObjectiveProgress } from "./dashboard-actions";

const METRIC_LABEL: Record<string, string> = {
  cash_total: "Contado",
  renting_total: "Renting",
  rental_total: "Alquiler",
  financier_total: "Financiera",
  units: "Unidades",
  any_total: "Total",
};

function fmtEur(c: number | null | undefined) {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

function color(pct: number | null) {
  if (pct == null) return "bg-muted";
  if (pct >= 100) return "bg-success";
  if (pct >= 75) return "bg-primary";
  if (pct >= 50) return "bg-warning";
  return "bg-destructive";
}

export function DashboardObjectivesCard({
  title,
  icon = "individual",
  data,
  emptyMsg,
}: {
  title: string;
  icon?: "individual" | "team";
  data: ObjectiveProgress[];
  emptyMsg: string;
}) {
  const Icon = icon === "team" ? Users : Target;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMsg}</p>
        ) : (
          <ul className="space-y-3">
            {data.map((o) => {
              const showAmount = o.target_amount_cents != null && o.target_amount_cents > 0;
              const showUnits = o.target_units != null && o.target_units > 0;
              return (
                <li key={o.id} className="space-y-1.5 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">
                      {METRIC_LABEL[o.metric_kind] ?? o.metric_kind}
                    </span>
                    <Badge variant="outline">{o.scope_label}</Badge>
                  </div>
                  {showAmount && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Importe</span>
                        <span className="font-bold tabular-nums">
                          {fmtEur(o.actual_amount_cents)} / {fmtEur(o.target_amount_cents)}
                          {o.percent_amount != null && (
                            <span className="ml-1 text-muted-foreground">({o.percent_amount}%)</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${color(o.percent_amount)}`}
                          style={{ width: `${Math.min(o.percent_amount ?? 0, 100)}%` }}
                        />
                      </div>
                    </>
                  )}
                  {showUnits && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Unidades</span>
                        <span className="font-bold tabular-nums">
                          {o.actual_units} / {o.target_units}
                          {o.percent_units != null && (
                            <span className="ml-1 text-muted-foreground">({o.percent_units}%)</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${color(o.percent_units)}`}
                          style={{ width: `${Math.min(o.percent_units ?? 0, 100)}%` }}
                        />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
