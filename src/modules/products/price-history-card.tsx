import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { PriceHistoryRow } from "./bulk-actions";

const CHANGE_KIND_LABEL: Record<string, string> = {
  cash_price: "Contado",
  individual_price: "Particular",
  company_price: "Empresa",
  min_authorized: "Mín. autorizado",
  cost: "Coste (CMP)",
};

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(c / 100);
}

export function PriceHistoryCard({ rows }: { rows: PriceHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span>Histórico de precios</span>
          <span className="text-xs font-normal text-muted-foreground">
            {rows.length} cambios registrados
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            Sin cambios de precio registrados. Cuando ajustes precios desde
            la ficha o vía bulk, aparecerán aquí.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const diff =
                r.previous_cents != null ? r.new_cents - r.previous_cents : null;
              const Icon =
                diff == null
                  ? Minus
                  : diff > 0
                    ? ArrowUp
                    : diff < 0
                      ? ArrowDown
                      : Minus;
              const color =
                diff == null
                  ? "text-muted-foreground"
                  : diff > 0
                    ? "text-red-700"
                    : diff < 0
                      ? "text-emerald-700"
                      : "text-muted-foreground";
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {CHANGE_KIND_LABEL[r.change_kind] ?? r.change_kind}
                      </Badge>
                      {r.plan_type && (
                        <Badge variant="secondary" className="text-[10px]">
                          {PLAN_LABEL[r.plan_type] ?? r.plan_type}
                          {r.duration_months ? ` · ${r.duration_months}m` : ""}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.changed_at).toLocaleString("es-ES")}
                        {r.changed_by_name && ` · ${r.changed_by_name}`}
                      </span>
                    </div>
                    {r.reason && (
                      <div className="mt-0.5 text-xs italic text-muted-foreground">
                        {r.reason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm tabular-nums">
                    <span className="text-muted-foreground line-through">
                      {eur(r.previous_cents)}
                    </span>
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="font-bold">{eur(r.new_cents)}</span>
                    {diff != null && (
                      <span className={`text-xs ${color}`}>
                        ({diff > 0 ? "+" : ""}
                        {eur(diff)})
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
