import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { LostSaleRowActions } from "@/modules/lost-sales/row-actions";
import { listTeamMembers } from "@/modules/agenda/actions";

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
  assigned_recovery_user_id: string | null;
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
  const session = await requireSession();
  // Solo admin / directores ven ventas perdidas. Nivel 3 no necesita
  // este reporte transversal — su info ya está en leads/clientes.
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) redirect("/dashboard");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Backfill: leads con status='lost' que no tienen fila en lost_sales aún
  // (porque se marcaron lost antes del commit que añadió la inserción).
  if (session.company_id) {
    const { data: lostLeads } = await supabase
      .from("leads")
      .select("id, lost_at, lost_reason")
      .eq("company_id", session.company_id)
      .eq("status", "lost")
      .is("deleted_at", null)
      .limit(500);
    const leadIdList = ((lostLeads ?? []) as Array<{
      id: string;
      lost_at: string | null;
      lost_reason: string | null;
    }>);
    if (leadIdList.length > 0) {
      const { data: existing } = await supabase
        .from("lost_sales")
        .select("lead_id")
        .eq("company_id", session.company_id)
        .eq("origin", "lead_lost")
        .in(
          "lead_id",
          leadIdList.map((l) => l.id),
        );
      const existingSet = new Set(
        ((existing ?? []) as Array<{ lead_id: string | null }>)
          .map((e) => e.lead_id)
          .filter((v): v is string => !!v),
      );
      const missing = leadIdList.filter((l) => !existingSet.has(l.id));
      if (missing.length > 0) {
        await supabase.from("lost_sales").insert(
          missing.map((l) => ({
            company_id: session.company_id,
            origin: "lead_lost",
            lead_id: l.id,
            reason: l.lost_reason ?? null,
            is_recovered: false,
          })),
        );
      }
    }
  }

  const { data } = await supabase
    .from("lost_sales")
    .select(
      "id, origin, lead_id, reason, reason_category, amount_cents, is_recovered, assigned_recovery_user_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];
  const team = await listTeamMembers().catch(() => []);

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
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {r.lead_id ? (
                        <Link
                          href={`/leads/${r.lead_id}` as never}
                          className="font-medium text-primary hover:underline"
                        >
                          {leadName(r.lead_id)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {ORIGIN_LABEL[r.origin] ?? r.origin} ·{" "}
                        {new Date(r.created_at).toLocaleDateString("es-ES")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold tabular-nums">
                        {formatCents(r.amount_cents)}
                      </div>
                      {r.is_recovered ? (
                        <Badge variant="success" className="mt-1">Recuperada</Badge>
                      ) : (
                        <Badge variant="destructive" className="mt-1">Sin recuperar</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2 border-t pt-2">
                    <div className="min-w-0 flex-1 text-xs">
                      {r.reason_category && (
                        <Badge variant="secondary" className="mr-1">{r.reason_category}</Badge>
                      )}
                      {r.reason}
                    </div>
                    <LostSaleRowActions
                      lostSaleId={r.id}
                      hasLead={!!r.lead_id}
                      isRecovered={r.is_recovered}
                      assignedUserId={r.assigned_recovery_user_id}
                      team={team}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabla */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Fecha</th>
                  <th className="py-2 text-left">Lead</th>
                  <th className="py-2 text-left">Origen</th>
                  <th className="py-2 text-left">Motivo</th>
                  <th className="py-2 text-right">Importe</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-right">Recuperación</th>
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
                    <td className="py-2 text-right">
                      <LostSaleRowActions
                        lostSaleId={r.id}
                        hasLead={!!r.lead_id}
                        isRecovered={r.is_recovered}
                        assignedUserId={r.assigned_recovery_user_id}
                        team={team}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
