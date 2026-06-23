import Link from "next/link";
import { Eye, FileCheck, PackageMinus } from "lucide-react";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { NewFreeTrialButton } from "@/modules/free-trials/new-trial-button";
import {
  FreeTrialSmartAlerts,
  getFreeTrialAlerts,
} from "@/modules/free-trials/smart-alerts";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Agendada",
  installed: "Instalada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  removed: "Retirada",
  expired: "Caducada",
};
const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  draft: "secondary",
  scheduled: "default",
  installed: "warning",
  accepted: "success",
  rejected: "destructive",
  removed: "outline",
  expired: "outline",
};

interface Row {
  id: string;
  reference_code: string | null;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  scheduled_at: string | null;
  installed_at: string | null;
  expires_at: string | null;
}

interface Party {
  id: string;
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function partyName(p: Party): string {
  return p.party_kind === "company"
    ? p.trade_name || p.legal_name || "Empresa"
    : `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Cliente";
}

function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

export default async function PruebasGratuitasPage() {
  const session = await requireSession();
  const companyId = session.company_id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Los nombres de cliente/lead se resuelven con el cliente admin filtrando por
  // empresa. Con el cliente RLS volvían vacíos en esta página (salía el genérico
  // "Cliente"/"Lead" en vez del nombre real). El filtro por company_id mantiene
  // el aislamiento entre empresas y solo se consultan ids ya visibles en la tabla.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [{ data }, alerts] = await Promise.all([
    supabase
      .from("free_trials")
      .select(
        "id, reference_code, status, customer_id, lead_id, scheduled_at, installed_at, expires_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    getFreeTrialAlerts().catch(() => null),
  ]);
  const rows = (data ?? []) as Row[];

  // Cargar nombres de clientes/leads + items en paralelo
  const customerIds = rows
    .map((r) => r.customer_id)
    .filter((v): v is string => !!v);
  const leadIds = rows.map((r) => r.lead_id).filter((v): v is string => !!v);
  const trialIds = rows.map((r) => r.id);

  const [custRes, leadRes, itemsRes] = await Promise.all([
    customerIds.length && companyId
      ? admin
          .from("customers")
          .select("id, party_kind, legal_name, trade_name, first_name, last_name")
          .eq("company_id", companyId)
          .in("id", customerIds)
      : Promise.resolve({ data: [] }),
    leadIds.length && companyId
      ? admin
          .from("leads")
          .select("id, party_kind, legal_name, trade_name, first_name, last_name")
          .eq("company_id", companyId)
          .in("id", leadIds)
      : Promise.resolve({ data: [] }),
    trialIds.length
      ? supabase
          .from("free_trial_items")
          .select("free_trial_id, product_name_snapshot, quantity")
          .in("free_trial_id", trialIds)
      : Promise.resolve({ data: [] }),
  ]);

  const cMap = new Map<string, string>(
    ((custRes.data ?? []) as Party[]).map((p) => [p.id, partyName(p)]),
  );
  const lMap = new Map<string, string>(
    ((leadRes.data ?? []) as Party[]).map((p) => [p.id, partyName(p)]),
  );
  const itemsMap = new Map<
    string,
    Array<{ product_name_snapshot: string; quantity: number }>
  >();
  for (const it of (itemsRes.data ?? []) as Array<{
    free_trial_id: string;
    product_name_snapshot: string;
    quantity: number;
  }>) {
    const arr = itemsMap.get(it.free_trial_id) ?? [];
    arr.push({
      product_name_snapshot: it.product_name_snapshot,
      quantity: it.quantity,
    });
    itemsMap.set(it.free_trial_id, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Pruebas gratuitas</h1>
          <p className="text-sm text-muted-foreground">{rows.length} pruebas</p>
        </div>
        <NewFreeTrialButton />
      </div>

      {alerts && <FreeTrialSmartAlerts alerts={alerts} />}

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin pruebas. Se generan desde la ficha de un cliente o lead.
            </p>
          ) : (
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => {
                const partyLabel = r.customer_id
                  ? cMap.get(r.customer_id) ?? "Cliente"
                  : r.lead_id
                    ? lMap.get(r.lead_id) ?? "Lead"
                    : "Sin asignar";
                const partyHref = r.customer_id
                  ? `/clientes/${r.customer_id}`
                  : r.lead_id
                    ? `/leads/${r.lead_id}`
                    : null;
                const items = itemsMap.get(r.id) ?? [];
                const equiposLabel =
                  items.length === 0
                    ? "—"
                    : items
                        .map(
                          (it) =>
                            `${it.product_name_snapshot}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`,
                        )
                        .join(", ");
                return (
                  <li key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/pruebas-gratuitas/${r.id}` as never}
                          className="font-mono text-[11px] text-primary hover:underline font-semibold"
                        >
                          {r.reference_code ?? `#${r.id.slice(0, 8)}`}
                        </Link>
                        {partyHref ? (
                          <Link
                            href={partyHref as never}
                            className="block font-medium text-primary hover:underline truncate"
                          >
                            {partyLabel}
                          </Link>
                        ) : (
                          <span className="block text-muted-foreground">{partyLabel}</span>
                        )}
                        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={equiposLabel}>
                          {equiposLabel}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[r.status]} className="shrink-0">
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                      <div>
                        {r.installed_at && <>Inst. {fmt(r.installed_at)} · </>}
                        {r.expires_at && <>Cad. {fmt(r.expires_at)}</>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/pruebas-gratuitas/${r.id}` as never}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-primary"
                          title="Ver ficha"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                        {r.status === "installed" && (
                          <Link
                            href={`/pruebas-gratuitas/${r.id}` as never}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-2 text-xs font-semibold text-success hover:bg-success/20"
                            title="Aceptar y generar contrato"
                          >
                            <FileCheck className="h-3.5 w-3.5" /> Aceptar
                          </Link>
                        )}
                        {(r.status === "installed" ||
                          r.status === "rejected" ||
                          r.status === "expired") && (
                          <Link
                            href={`/pruebas-gratuitas/${r.id}` as never}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 px-2 text-xs font-semibold text-warning hover:bg-warning/20"
                            title="Agendar desinstalación"
                          >
                            <PackageMinus className="h-3.5 w-3.5" /> Desinst.
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Ref.</th>
                    <th className="py-2 text-left">Cliente / Lead</th>
                    <th className="py-2 text-left">Equipos</th>
                    <th className="py-2 text-left">Estado</th>
                    <th className="py-2 text-left">Instalada</th>
                    <th className="py-2 text-left">Caduca</th>
                    <th className="py-2 text-right pr-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const partyLabel = r.customer_id
                      ? cMap.get(r.customer_id) ?? "Cliente"
                      : r.lead_id
                        ? lMap.get(r.lead_id) ?? "Lead"
                        : "Sin asignar";
                    const partyHref = r.customer_id
                      ? `/clientes/${r.customer_id}`
                      : r.lead_id
                        ? `/leads/${r.lead_id}`
                        : null;
                    const items = itemsMap.get(r.id) ?? [];
                    const equiposLabel =
                      items.length === 0
                        ? "—"
                        : items
                            .map(
                              (it) =>
                                `${it.product_name_snapshot}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`,
                            )
                            .join(", ");
                    return (
                      <tr key={r.id} className="hover:bg-muted/50">
                        <td className="py-2 font-mono text-xs">
                          <Link
                            href={`/pruebas-gratuitas/${r.id}` as never}
                            className="text-primary hover:underline font-semibold"
                          >
                            {r.reference_code ?? `#${r.id.slice(0, 8)}`}
                          </Link>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-col gap-0.5">
                            {partyHref ? (
                              <Link
                                href={partyHref as never}
                                className="font-medium text-primary hover:underline"
                              >
                                {partyLabel}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">
                                {partyLabel}
                              </span>
                            )}
                            <Badge
                              variant={r.customer_id ? "secondary" : "outline"}
                              className="w-fit text-[10px]"
                            >
                              {r.customer_id ? "Cliente" : "Lead"}
                            </Badge>
                          </div>
                        </td>
                        <td
                          className="py-2 max-w-[220px] truncate text-xs"
                          title={equiposLabel}
                        >
                          {equiposLabel}
                        </td>
                        <td className="py-2">
                          <Badge variant={STATUS_VARIANT[r.status]}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {fmt(r.installed_at)}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {fmt(r.expires_at)}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center justify-end gap-1.5 pr-2">
                            <Link
                              href={`/pruebas-gratuitas/${r.id}` as never}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-primary"
                              title="Ver ficha"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                            {r.status === "installed" && (
                              <Link
                                href={`/pruebas-gratuitas/${r.id}` as never}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-2 text-xs font-semibold text-success hover:bg-success/20"
                                title="Aceptar y generar contrato"
                              >
                                <FileCheck className="h-3.5 w-3.5" /> Aceptar
                              </Link>
                            )}
                            {(r.status === "installed" ||
                              r.status === "rejected" ||
                              r.status === "expired") && (
                              <Link
                                href={`/pruebas-gratuitas/${r.id}` as never}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 px-2 text-xs font-semibold text-warning hover:bg-warning/20"
                                title="Agendar desinstalación"
                              >
                                <PackageMinus className="h-3.5 w-3.5" /> Desinstalar
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
