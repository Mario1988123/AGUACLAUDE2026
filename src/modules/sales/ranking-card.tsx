import { Trophy, Medal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { RankingRow } from "./dashboard-actions";

function fmtEur(c: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function RankingCard({
  rows,
  highlightUserId,
}: {
  rows: RankingRow[];
  highlightUserId?: string;
}) {
  const max = rows[0]?.total_cents ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-warning" />
          Ranking del mes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas registradas este mes.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, idx) => {
              const isMe = r.user_id === highlightUserId;
              const pct = max > 0 ? Math.round((r.total_cents * 100) / max) : 0;
              return (
                <li
                  key={r.user_id}
                  className={`relative overflow-hidden rounded-xl border p-3 ${isMe ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/10"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-sm">
                      {idx === 0 ? (
                        <Medal className="h-5 w-5 text-warning" />
                      ) : (
                        `#${idx + 1}`
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm">
                        {r.user_name}
                        {isMe && <span className="ml-2 text-xs text-primary">(tú)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.units} ventas</div>
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      {fmtEur(r.total_cents)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          🏆 Próximamente: programa de puntos vinculado al ranking.
        </p>
      </CardContent>
    </Card>
  );
}
