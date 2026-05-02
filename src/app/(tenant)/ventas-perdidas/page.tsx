import Link from "next/link";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const ORIGIN_LABEL: Record<string, string> = {
  lead_lost: "Lead perdido",
  free_trial_rejected: "Prueba rechazada",
  free_trial_removed: "Prueba retirada",
};

interface Row {
  id: string;
  origin: string;
  lead_id: string | null;
  reason: string | null;
  reason_category: string | null;
  amount_cents: number | null;
  is_recovered: boolean;
  created_at: string;
}

interface LeadInfo {
  id: string;
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_primary: string | null;
}

export default async function VentasPerdidasPage() {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("lost_sales")
    .select("id, origin, lead_id, reason, reason_category, amount_cents, is_recovered, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter((v): v is string => !!v)));
  const leadMap = new Map<string, LeadInfo>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
      .in("id", leadIds);
    for (const l of (leads ?? []) as LeadInfo[]) leadMap.set(l.id, l);
  }
  function leadName(id: string | null): string {
    if (!id) return "—";
    const l = leadMap.get(id);
    if (!l) return "—";
    return l.party_kind === "company"
      ? l.trade_name || l.legal_name || "—"
      : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "—";
  }
  const totalLost = rows
    .filter((r) => !r.is_recovered)
    .reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const totalRecovered = rows
    .filter((r) => r.is_recovered)
    .reduce((s, r) => s + (r.amount_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ventas perdidas</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} entradas · {rows.filter((r) => !r.is_recovered).length} sin recuperar
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-destructive bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Sin recuperar</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatCents(totalLost)}</div>
        </div>
        <div className="rounded-lg border border-success bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recuperadas</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{formatCents(totalRecovered)}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas perdidas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Fecha</th>
                  <th className="py-2 text-left">Lead</th>
                  <th className="py-2 text-left">Origen</th>
                  <th className="py-2 text-left">Motivo</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50">
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("es-ES")}
                    </td>
                    <td className="py-2">
                      {r.lead_id ? (
                        <Link
                          href={`/leads/${r.lead_id}` as never}
                          className="text-primary hover:underline"
                        >
                          {leadName(r.lead_id)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">{ORIGIN_LABEL[r.origin] ?? r.origin}</td>
                    <td className="py-2 text-xs">
                      {r.reason_category && (
                        <Badge variant="secondary">{r.reason_category}</Badge>
                      )}{" "}
                      {r.reason}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCents(r.amount_cents)}</td>
                    <td className="py-2">
                      {r.is_recovered ? (
                        <Badge variant="success">Recuperada</Badge>
                      ) : (
                        <Badge variant="destructive">Sin recuperar</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
