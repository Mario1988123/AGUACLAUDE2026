import Link from "next/link";
import { ShieldCheck, Calendar } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface Row {
  id: string;
  scheduled_at: string;
  customer_name: string | null;
  is_today: boolean;
  is_tomorrow: boolean;
  status: string;
}

const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  scheduled: "Agendado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  skipped: "Saltado",
  invoiced: "Facturado",
};

export function UpcomingMaintenanceCard({ items }: { items: Row[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Próximos mantenimientos (7 días)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin mantenimientos próximos.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((m) => {
              const d = new Date(m.scheduled_at);
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <span className="text-[10px] font-bold uppercase leading-none">
                      {d.toLocaleDateString("es-ES", { month: "short" })}
                    </span>
                    <span className="text-base font-bold leading-none">{d.getDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/mantenimientos/${m.id}` as never}
                      className="text-sm font-semibold hover:underline"
                    >
                      {m.customer_name ?? "—"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      <Calendar className="mr-1 inline h-3 w-3" />
                      {d.toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {m.is_today && <Badge variant="warning">Hoy</Badge>}
                  {m.is_tomorrow && <Badge variant="default">Mañana</Badge>}
                  {!m.is_today && !m.is_tomorrow && (
                    <Badge variant="outline">
                      {MAINTENANCE_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
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

export async function getUpcomingMaintenance(): Promise<Row[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createClient } = await import("@/shared/lib/supabase/server");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const session = await requireSession();
  if (!session.company_id) return [];
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(now.getDate() + 7);

  let q = supabase
    .from("maintenance_jobs")
    .select("id, scheduled_at, customer_id, status, technician_user_id")
    .eq("status", "scheduled")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", in7.toISOString())
    .order("scheduled_at")
    .limit(10);
  if (visibleUserIds) q = q.in("technician_user_id", visibleUserIds);
  const { data } = await q;
  type J = { id: string; scheduled_at: string; customer_id: string; status: string };
  const jobs = (data ?? []) as J[];
  if (jobs.length === 0) return [];

  const cIds = Array.from(new Set(jobs.map((j) => j.customer_id)));
  const { data: cs } = await supabase
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .in("id", cIds);
  type CC = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  const nameMap = new Map(
    ((cs ?? []) as CC[]).map((c) => [
      c.id,
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "—"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—",
    ]),
  );

  const todayKey = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  return jobs.map((j) => {
    const k = new Date(j.scheduled_at).toISOString().slice(0, 10);
    return {
      id: j.id,
      scheduled_at: j.scheduled_at,
      customer_name: nameMap.get(j.customer_id) ?? null,
      is_today: k === todayKey,
      is_tomorrow: k === tomorrowKey,
      status: j.status,
    };
  });
}
