"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Crown, Medal, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { UserAvatar } from "@/shared/components/user-avatar";
import type { PointsRankingRow } from "./ranking-actions";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

type Range = "month" | "year";

export function PointsRankingCard({
  rows,
  highlightUserId,
  title = "Clasificación",
  /** user_ids cuyo desglose puede ver la sesión actual (admin, dueño, o
   *  miembros del equipo de un director). Si la sesión está aquí, la fila
   *  se renderiza como link a /puntos?breakdown=userId; si no, texto plano. */
  breakdownAllowedIds,
  /** Pestaña inicial. Por defecto mes. */
  initialRange = "month",
}: {
  rows: PointsRankingRow[];
  highlightUserId?: string;
  title?: string;
  breakdownAllowedIds?: Set<string>;
  initialRange?: Range;
}) {
  const [range, setRange] = useState<Range>(initialRange);

  // Ordenar según el rango activo. Hacemos una copia para no mutar.
  const sorted = useMemo(() => {
    const key: keyof PointsRankingRow =
      range === "month" ? "points_month" : "points_year";
    return [...rows].sort(
      (a, b) => (b[key] as number) - (a[key] as number),
    );
  }, [rows, range]);

  const max = range === "month"
    ? sorted[0]?.points_month ?? 0
    : sorted[0]?.points_year ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-warning" />
            {title}
          </span>
          <div
            role="tablist"
            aria-label="Rango del ranking"
            className="inline-flex rounded-xl border border-border bg-muted/40 p-0.5 text-xs font-semibold"
          >
            <button
              type="button"
              role="tab"
              aria-selected={range === "month"}
              onClick={() => setRange("month")}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                range === "month"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Mensual
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={range === "year"}
              onClick={() => setRange("year")}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                range === "year"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Anual
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {range === "month"
              ? "Aún no hay puntos acumulados este mes."
              : "Aún no hay puntos acumulados este año."}
          </p>
        ) : (
          <ol className="space-y-2">
            {sorted.map((r, idx) => {
              const isMe = r.user_id === highlightUserId;
              const value = range === "month" ? r.points_month : r.points_year;
              const pct = max > 0 ? Math.round((value * 100) / max) : 0;
              const canDrill = breakdownAllowedIds?.has(r.user_id) ?? false;
              // Métrica secundaria: en mes mostramos el acumulado año, en
              // año mostramos los puntos del mes para no perder contexto.
              const secondary =
                range === "month"
                  ? `${r.points_year} pts acumulados año`
                  : `${r.points_month} pts este mes`;
              const valueLabel = range === "month" ? "pts mes" : "pts año";
              const inner = (
                <>
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/10"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
                      {idx === 0 ? (
                        <Crown className="h-6 w-6 text-warning" />
                      ) : idx === 1 ? (
                        <Medal className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        `#${idx + 1}`
                      )}
                    </div>
                    <UserAvatar userId={r.user_id} name={r.user_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                        {r.user_name}
                        {isMe && <span className="text-xs text-primary">(tú)</span>}
                        {r.department && (
                          <span className="text-xs text-muted-foreground">
                            · {DEPT_LABEL[r.department] ?? r.department}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{secondary}</span>
                        {r.equipments_month > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-semibold">
                            <Package className="h-3 w-3" />
                            {r.equipments_month} equipo{r.equipments_month === 1 ? "" : "s"} mes
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums">{value}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {valueLabel}
                      </div>
                    </div>
                  </div>
                </>
              );
              const baseCls = `relative overflow-hidden rounded-2xl border p-3 ${
                isMe ? "border-primary bg-primary/5" : "border-border bg-card"
              }`;
              return (
                <li key={r.user_id}>
                  {canDrill ? (
                    <Link
                      href={`/puntos?breakdown=${r.user_id}` as never}
                      className={`${baseCls} block transition-colors hover:border-primary/60`}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className={baseCls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
