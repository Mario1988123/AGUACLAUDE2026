import Link from "next/link";
import { ListChecks, Package, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { reasonLabel } from "./reason-labels";
import type { PointsBreakdown } from "./breakdown-actions";

const SUBJECT_HREF: Record<string, (id: string) => string> = {
  contract: (id) => `/contratos/${id}`,
  lead: (id) => `/leads/${id}`,
  installation: (id) => `/instalaciones/${id}`,
  maintenance: (id) => `/mantenimientos/${id}`,
  incident: (id) => `/incidencias/${id}`,
};

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function PointsBreakdownCard({
  data,
  isOwn,
}: {
  data: PointsBreakdown;
  isOwn: boolean;
}) {
  const monthLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;
  const title = isOwn
    ? `Mi desglose · ${monthLabel}`
    : `Desglose de ${data.user_name} · ${monthLabel}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" /> {title}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {data.lines.length} evento{data.lines.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Star className="h-3.5 w-3.5" /> Puntos del mes
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {data.total_points.toLocaleString("es-ES")}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Equipos vendidos del mes
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {data.total_equipments}
            </div>
          </div>
        </div>

        {data.lines.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            Sin movimientos este mes.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {data.lines.map((l) => {
              const href =
                l.subject_type && l.subject_id
                  ? SUBJECT_HREF[l.subject_type]?.(l.subject_id) ?? null
                  : null;
              const label = reasonLabel(l.reason);
              const when = new Date(l.awarded_at).toLocaleString("es-ES", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });
              const sub = l.subject_label;
              return (
                <li
                  key={l.id}
                  className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{label}</span>
                      {l.reason === "sale_with_discount" && (
                        <Badge variant="warning" className="text-[10px]">
                          con descuento
                        </Badge>
                      )}
                    </div>
                    {sub && (
                      <div className="text-xs text-muted-foreground">
                        {href ? (
                          <Link href={href as never} className="hover:underline">
                            {sub}
                          </Link>
                        ) : (
                          sub
                        )}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">{when}</div>
                  </div>
                  <div
                    className={`shrink-0 text-right font-bold tabular-nums ${
                      l.points >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {l.points > 0 ? `+${l.points}` : l.points}
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      pts
                    </div>
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
