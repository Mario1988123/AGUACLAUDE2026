import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Smile } from "lucide-react";

interface Row {
  installer_user_id: string;
  installer_name: string;
  count: number;
  avg: number;
  histogram: [number, number, number, number, number];
}

const FACES: Record<number, string> = {
  1: "😡",
  2: "😟",
  3: "😐",
  4: "🙂",
  5: "😄",
};

async function getRanking(days = 90): Promise<{
  rows: Row[];
  global_avg: number | null;
  total_responses: number;
} | null> {
  try {
    const session = await requireSession();
    if (!session.company_id) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data } = await admin
      .from("installations")
      .select("installer_user_id, satisfaction_score, completed_at")
      .eq("company_id", session.company_id)
      .eq("status", "completed")
      .gte("completed_at", since.toISOString())
      .not("satisfaction_score", "is", null)
      .not("installer_user_id", "is", null);
    type I = {
      installer_user_id: string;
      satisfaction_score: number;
    };
    const list = (data ?? []) as I[];
    if (list.length === 0) {
      return { rows: [], global_avg: null, total_responses: 0 };
    }

    // Resolver nombres de instaladores
    const userIds = Array.from(
      new Set(list.map((r) => r.installer_user_id)),
    );
    const { data: profs } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    type P = { user_id: string; full_name: string | null };
    const nameMap = new Map<string, string>();
    for (const p of ((profs ?? []) as P[])) {
      nameMap.set(p.user_id, p.full_name ?? "Sin nombre");
    }

    // Agregar por instalador
    const byInstaller = new Map<
      string,
      { count: number; sum: number; histogram: [number, number, number, number, number] }
    >();
    let totalSum = 0;
    for (const r of list) {
      const cur = byInstaller.get(r.installer_user_id) ?? {
        count: 0,
        sum: 0,
        histogram: [0, 0, 0, 0, 0] as [number, number, number, number, number],
      };
      cur.count += 1;
      cur.sum += r.satisfaction_score;
      const idx = Math.max(1, Math.min(5, r.satisfaction_score)) - 1;
      cur.histogram[idx] = (cur.histogram[idx] ?? 0) + 1;
      byInstaller.set(r.installer_user_id, cur);
      totalSum += r.satisfaction_score;
    }

    const rows: Row[] = Array.from(byInstaller.entries())
      .map(([uid, v]) => ({
        installer_user_id: uid,
        installer_name: nameMap.get(uid) ?? "Sin nombre",
        count: v.count,
        avg: Math.round((v.sum / v.count) * 10) / 10,
        histogram: v.histogram,
      }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count);

    return {
      rows,
      global_avg: Math.round((totalSum / list.length) * 10) / 10,
      total_responses: list.length,
    };
  } catch {
    return null;
  }
}

export async function InstallationSatisfactionRanking() {
  const data = await getRanking();
  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smile className="h-5 w-5" /> Encuestas de satisfacción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aún no hay encuestas registradas en los últimos 90 días.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smile className="h-5 w-5" /> Ranking satisfacción (90 días)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
          <span className="text-sm font-semibold text-blue-900">
            Media global
          </span>
          <span className="text-2xl font-extrabold text-blue-900">
            {data.global_avg ?? "—"} <span className="text-base font-bold">/ 5</span>
          </span>
          <span className="text-xs text-blue-800">
            {data.total_responses} respuesta{data.total_responses === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="divide-y">
          {data.rows.map((r, idx) => (
            <li
              key={r.installer_user_id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    idx === 0
                      ? "bg-amber-200 text-amber-900"
                      : idx === 1
                        ? "bg-zinc-200 text-zinc-700"
                        : idx === 2
                          ? "bg-orange-200 text-orange-900"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.installer_name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} title={`${r.histogram[n - 1]} respuestas`}>
                        {FACES[n]}
                        <span className="ml-0.5 font-mono">
                          {r.histogram[n - 1]}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tabular-nums">
                  {r.avg.toFixed(1)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {r.count} encuesta{r.count === 1 ? "" : "s"}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Encuestas anónimas — el instalador NO ve la respuesta del cliente.
        </p>
      </CardContent>
    </Card>
  );
}
