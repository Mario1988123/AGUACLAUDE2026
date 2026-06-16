import Link from "next/link";
import { Plus, Download } from "lucide-react";
import { listLeads } from "@/modules/leads/actions";
import { Button } from "@/shared/ui/button";
import {
  STATUS_LABEL,
  LEAD_STATUS,
  LEAD_ORIGIN,
  ORIGIN_LABEL,
  LEAD_POTENTIAL,
} from "@/modules/leads/schemas";
import { requireSession } from "@/shared/lib/auth/session";
import { SelectableLeadsTable } from "@/modules/leads/selectable-list";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportLeadsButton } from "@/modules/leads/import-form";
// LeadSmartAlerts y getLeadAlerts ya no se usan aquí (2026-06-02). Se
// mantienen exportados desde el módulo por si se usan en un panel global
// del dashboard.
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
    sort?: string;
    origin?: string;
    potential?: string;
  }>;
}) {
  const sp = await searchParams;
  const originFilter = LEAD_ORIGIN.includes(sp.origin as never)
    ? (sp.origin as never)
    : undefined;
  const potentialFilter = LEAD_POTENTIAL.includes(sp.potential as never)
    ? (sp.potential as never)
    : undefined;
  const tempFilter = (["hot", "warm", "cold", "lost"].includes(sp.temp ?? "")
    ? sp.temp
    : undefined) as "hot" | "warm" | "cold" | "lost" | undefined;
  const sortBy = (["recent", "oldest", "name"].includes(sp.sort ?? "")
    ? sp.sort
    : "recent") as "recent" | "oldest" | "name";
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
  const [leadsAll, team] = await Promise.all([
    listLeads({
      status,
      q: sp.q,
      scope,
      assigned_user_id: assignedFilter as string | "unassigned" | undefined,
    }),
    isUpperLevel ? listTeamMembers().catch(() => []) : Promise.resolve([]),
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
  const leadsFiltered = leadsAll.filter((l) => {
    if (tempFilter && classify(l) !== tempFilter) return false;
    if (originFilter && l.origin !== originFilter) return false;
    if (potentialFilter && l.potential !== potentialFilter) return false;
    return true;
  });

  // Orden 2026-06-02. "oldest" = más antiguos primero (los que más días
  // llevan en cartera, candidatos a caducar / abandono).
  const leads = [...leadsFiltered].sort((a, b) => {
    if (sortBy === "oldest") {
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }
    if (sortBy === "name") {
      return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    }
    // "recent" (default): más nuevos primero
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // baseQuery sin el param "temp" (para construir URLs del panel)
  const baseParams = new URLSearchParams();
  if (scope === "mine") baseParams.set("scope", "mine");
  if (status) baseParams.set("status", status);
  if (sp.q) baseParams.set("q", sp.q);
  if (assignedFilter) baseParams.set("assigned", assignedFilter);
  if (originFilter) baseParams.set("origin", originFilter);
  if (potentialFilter) baseParams.set("potential", potentialFilter);
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

      {/* El "Pulso del pipeline" (LeadSmartAlerts) se eliminó 2026-06-02:
          ocupaba demasiado, sus métricas ya están reflejadas en la tabla
          (colores por urgencia) y en el TemperaturePanel compacto.
          getLeadAlerts() sigue disponible si en el futuro se quiere un
          panel global de alertas en el dashboard. */}

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
        <select
          name="origin"
          defaultValue={originFilter ?? ""}
          aria-label="Filtrar por origen"
          className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
        >
          <option value="">Cualquier origen</option>
          {LEAD_ORIGIN.map((o) => (
            <option key={o} value={o}>
              {ORIGIN_LABEL[o]}
            </option>
          ))}
        </select>
        <select
          name="potential"
          defaultValue={potentialFilter ?? ""}
          aria-label="Filtrar por potencial"
          className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
        >
          <option value="">Cualquier potencial</option>
          {LEAD_POTENTIAL.map((p) => (
            <option key={p} value={p}>
              {p === "unknown" ? "Sin clasificar" : `Clase ${p}`}
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
        <select
          name="sort"
          defaultValue={sortBy}
          aria-label="Ordenar leads"
          className="flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-auto"
        >
          <option value="recent">Más recientes primero</option>
          <option value="oldest">Más antiguos primero (días)</option>
          <option value="name">Por nombre A-Z</option>
        </select>
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
