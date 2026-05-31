import Link from "next/link";
import { Plus, Download } from "lucide-react";
import { listLeads } from "@/modules/leads/actions";
import { Button } from "@/shared/ui/button";
import {
  STATUS_LABEL,
  LEAD_STATUS,
} from "@/modules/leads/schemas";
import { requireSession } from "@/shared/lib/auth/session";
import { SelectableLeadsTable } from "@/modules/leads/selectable-list";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportLeadsButton } from "@/modules/leads/import-form";
import { LeadSmartAlerts, getLeadAlerts } from "@/modules/leads/smart-alerts";
import { LeadsTemperaturePanel } from "@/modules/leads/temperature-panel";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    scope?: string;
    assigned?: string;
    temp?: string;
  }>;
}) {
  const sp = await searchParams;
  const tempFilter = (["hot", "warm", "cold", "lost"].includes(sp.temp ?? "")
    ? sp.temp
    : undefined) as "hot" | "warm" | "cold" | "lost" | undefined;
  const session = await requireSession();
  const status = LEAD_STATUS.includes(sp.status as never) ? (sp.status as never) : undefined;
  const isUpperLevel =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director") ||
    session.roles.includes("technical_director");
  const scope = isUpperLevel ? (sp.scope === "mine" ? "mine" : "all") : "mine";
  const assignedFilter = isUpperLevel && sp.assigned ? sp.assigned : undefined;
  const [leadsAll, team, alerts] = await Promise.all([
    listLeads({
      status,
      q: sp.q,
      scope,
      assigned_user_id: assignedFilter as string | "unassigned" | undefined,
    }),
    isUpperLevel ? listTeamMembers().catch(() => []) : Promise.resolve([]),
    isUpperLevel
      ? getLeadAlerts(scope === "mine" ? session.user_id : null).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Filtro temperatura client-side (los datos ya están cargados)
  function classify(l: { status: string; created_at: string }): "hot" | "warm" | "cold" | "lost" | null {
    if (l.status === "converted") return null;
    if (l.status === "lost" || l.status === "expired") return "lost";
    if (
      l.status === "proposal_created" ||
      l.status === "proposal_sent" ||
      l.status === "free_trial_proposed"
    ) {
      return "hot";
    }
    if (l.status === "contacted") return "warm";
    const ageH = (Date.now() - new Date(l.created_at).getTime()) / 3600000;
    return ageH < 24 ? "warm" : "cold";
  }
  const leads = tempFilter
    ? leadsAll.filter((l) => classify(l) === tempFilter)
    : leadsAll;

  // baseQuery sin el param "temp" (para construir URLs del panel)
  const baseParams = new URLSearchParams();
  if (scope === "mine") baseParams.set("scope", "mine");
  if (status) baseParams.set("status", status);
  if (sp.q) baseParams.set("q", sp.q);
  if (assignedFilter) baseParams.set("assigned", assignedFilter);
  const baseQuery = baseParams.toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">{leads.length} resultados</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isUpperLevel && <ImportLeadsButton />}
          <Link
            href={"/api/export/leads" as never}
            prefetch={false}
            aria-label="Exportar leads a CSV"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Exportar CSV</span>
            <span className="sm:hidden">CSV</span>
          </Link>
          <Button asChild>
            <Link href={"/leads/nuevo" as never} aria-label="Crear nuevo lead">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Nuevo lead</span>
              <span className="sm:hidden">Nuevo</span>
            </Link>
          </Button>
        </div>
      </div>

      {isUpperLevel && (
        <div className="flex gap-2">
          <Link
            href={"/leads" as never}
            prefetch={false}
            className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
              scope === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            Todos
          </Link>
          <Link
            href={"/leads?scope=mine" as never}
            prefetch={false}
            className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
              scope === "mine"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            Mi cartera
          </Link>
        </div>
      )}

      {isUpperLevel && alerts && <LeadSmartAlerts alerts={alerts} />}

      <LeadsTemperaturePanel
        leads={leadsAll.map((l) => ({ status: l.status as never, created_at: l.created_at }))}
        activeTemp={tempFilter}
        baseQuery={baseQuery}
      />

      <form
        role="search"
        aria-label="Filtrar leads"
        className="flex flex-wrap gap-2 rounded-lg border bg-card p-3 sm:p-4"
      >
        {scope === "mine" && <input type="hidden" name="scope" value="mine" />}
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por nombre, email, teléfono..."
          aria-label="Buscar leads"
          className="flex h-11 w-full flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:min-w-[14rem]"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          aria-label="Filtrar por estado"
          className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
        >
          <option value="">Todos los estados</option>
          {LEAD_STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {isUpperLevel && (
          <select
            name="assigned"
            defaultValue={assignedFilter ?? ""}
            aria-label="Filtrar por comercial asignado"
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">Cualquier comercial</option>
            <option value="unassigned">⚠ Sin asignar</option>
            {team.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.full_name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="outline" className="w-full sm:w-auto">
          Filtrar
        </Button>
      </form>

      <SelectableLeadsTable
        leads={leads}
        team={team}
        canBulkReassign={
          session.is_superadmin || session.roles.includes("company_admin")
        }
      />
    </div>
  );
}
