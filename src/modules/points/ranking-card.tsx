import { Crown, Medal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { UserAvatar } from "@/shared/components/user-avatar";
import type { PointsRankingRow } from "./ranking-actions";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

export function PointsRankingCard({
  rows,
  highlightUserId,
  title = "Clasificación",
}: {
  rows: PointsRankingRow[];
  highlightUserId?: string;
  title?: string;
}) {
  const max = rows[0]?.points_month ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-warning" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay puntos acumulados este mes.
          </p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, idx) => {
              const isMe = r.user_id === highlightUserId;
              const pct = max > 0 ? Math.round((r.points_month * 100) / max) : 0;
              return (
                <li
                  key={r.user_id}
                  className={`relative overflow-hidden rounded-2xl border p-3 ${
                    isMe ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
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
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {r.user_name}
                        {isMe && <span className="text-xs text-primary">(tú)</span>}
                        {r.department && (
                          <span className="text-xs text-muted-foreground">
                            · {DEPT_LABEL[r.department] ?? r.department}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.points_year} pts acumulados año
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums">{r.points_month}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        pts mes
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
