import Link from "next/link";
import { Wrench } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface Row {
  id: string;
  reference_code: string | null;
  scheduled_at: string;
  customer_name: string | null;
  is_today: boolean;
  is_tomorrow: boolean;
}

export function UpcomingInstallationsCard({ items }: { items: Row[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          Próximas instalaciones (7 días)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin instalaciones próximas.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => {
              const d = new Date(i.scheduled_at);
              return (
                <li
                  key={i.id}
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
                      href={`/instalaciones/${i.id}` as never}
                      className="text-sm font-semibold hover:underline"
                    >
                      {i.customer_name ?? "—"}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.reference_code ?? `#${i.id.slice(0, 8)}`} ·{" "}
                      {d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {i.is_today && <Badge variant="warning">Hoy</Badge>}
                  {i.is_tomorrow && <Badge variant="default">Mañana</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function getUpcomingInstallations(): Promise<Row[]> {
  const { createClient } = await import("@/shared/lib/supabase/server");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(now.getDate() + 7);

  const { data } = await supabase
    .from("installations")
    .select("id, reference_code, scheduled_at, customer_id, status")
    .in("status", ["scheduled", "unscheduled"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", in7.toISOString())
    .is("deleted_at", null)
    .order("scheduled_at")
    .limit(10);
  type I = {
    id: string;
    reference_code: string | null;
    scheduled_at: string;
    customer_id: string;
    status: string;
  };
  const insts = (data ?? []) as I[];
  if (insts.length === 0) return [];

  const cIds = Array.from(new Set(insts.map((i) => i.customer_id)));
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

  return insts.map((i) => {
    const k = new Date(i.scheduled_at).toISOString().slice(0, 10);
    return {
      id: i.id,
      reference_code: i.reference_code,
      scheduled_at: i.scheduled_at,
      customer_name: nameMap.get(i.customer_id) ?? null,
      is_today: k === todayKey,
      is_tomorrow: k === tomorrowKey,
    };
  });
}
