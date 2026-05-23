import Link from "next/link";
import {
  listAgenda,
  listAgendaMonth,
  listAgendaRange,
  listAgendaRangeFull,
  listTeamMembers,
} from "@/modules/agenda/actions";
import { KIND_LABEL } from "@/modules/agenda/constants";
import { CreateAgendaButton } from "@/modules/agenda/create-form";
import { AgendaCalendar } from "@/modules/agenda/calendar";
import { DraggableAgendaList } from "@/modules/agenda/draggable-list";
import { AgendaWeekView } from "@/modules/agenda/week-view";
import { listUnscheduledInstallations } from "@/modules/installations/actions";
import { countMaintenanceToConfirm } from "@/modules/maintenance/to-confirm-actions";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/installations/constants";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { Calendar, ListTodo, CalendarDays, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const KIND_FILTER_OPTIONS = ["visit", "call", "manual", "meeting", "reminder"] as const;

const STATUS_FILTER_OPTIONS = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    kind?: string;
    view?: string;
    w?: string;
    from?: string;
    to?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const userFilter = sp.user || undefined;
  const kindFilter =
    sp.kind && KIND_FILTER_OPTIONS.includes(sp.kind as never) ? sp.kind : undefined;
  const view: "calendar" | "week" | "list" =
    sp.view === "list" ? "list" : sp.view === "week" ? "week" : "calendar";
  const statusFilter = sp.status && STATUS_FILTER_OPTIONS.includes(sp.status as never)
    ? (sp.status as StatusFilter)
    : undefined;
  const searchText = (sp.q ?? "").trim().toLowerCase();

  // En vista semana cargamos exactamente la semana visible (parámetro
  // ?w=YYYY-MM-DD = lunes de esa semana). Si no viene, la semana actual.
  // Para que listAgenda(14) sirva al resto de vistas mantenemos los dos
  // fetches en paralelo cuando aplica.
  const now = new Date();
  function startOfWeek(d: Date): Date {
    const day = (d.getDay() + 6) % 7; // lunes=0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  }
  let weekStart = startOfWeek(now);
  if (sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w)) {
    const parts = sp.w.split("-").map((n) => Number(n));
    const candidate = new Date(parts[0]!, (parts[1] ?? 1) - 1, parts[2] ?? 1);
    if (!Number.isNaN(candidate.getTime())) weekStart = startOfWeek(candidate);
  }
  const weekEnd = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 6,
    23,
    59,
    59,
    999,
  );

  const weekEventsPromise =
    view === "week"
      ? listAgendaRange(weekStart.toISOString(), weekEnd.toISOString(), {
          user_id: userFilter,
          kind: kindFilter,
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof listAgenda>>);

  // Vista listado: rango personalizable. Default mismo que antes (próximos
  // 14 días) para no romper la experiencia de quien venía de la versión
  // anterior. Pero ahora puede ampliarse desde la UI.
  function parseDate(v?: string): Date | null {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const parts = v.split("-").map((n) => Number(n));
    const d = new Date(parts[0]!, (parts[1] ?? 1) - 1, parts[2] ?? 1);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const listFrom =
    parseDate(sp.from) ??
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const listTo =
    parseDate(sp.to) ?? new Date(now.getTime() + 14 * 86400000);
  // Asegurar to >= from para no devolver array vacío por error de UX
  const listFromIso = listFrom.toISOString();
  const listToEnd = new Date(
    listTo.getFullYear(),
    listTo.getMonth(),
    listTo.getDate(),
    23,
    59,
    59,
    999,
  );
  const listToIso = listToEnd.toISOString();

  const listResultPromise =
    view === "list"
      ? listAgendaRangeFull(listFromIso, listToIso, {
          user_id: userFilter,
          kind: kindFilter,
          status: statusFilter ? [statusFilter] : undefined,
          limit: 500,
        })
      : Promise.resolve({ events: [], truncated: false, total_before_limit: 0 });

  const [
    events,
    monthEvents,
    weekEvents,
    listResult,
    team,
    session,
    unscheduled,
    pendingMaintenanceCount,
  ] = await Promise.all([
    listAgenda(14, { user_id: userFilter, kind: kindFilter }),
    listAgendaMonth(now.getFullYear(), now.getMonth()),
    weekEventsPromise,
    listResultPromise,
    listTeamMembers(),
    requireSession(),
    listUnscheduledInstallations().catch(() => []),
    countMaintenanceToConfirm(30).catch(() => 0),
  ]);

  // Búsqueda cliente-side por texto: filtra del array ya cargado para no
  // tener que hacer otra query (la búsqueda full-text en BD es trabajo de
  // otra fase). Match contra title.
  const listEvents = searchText
    ? listResult.events.filter((ev) =>
        ev.title.toLowerCase().includes(searchText),
      )
    : listResult.events;
  // Reasignar tareas: nivel 1 (admin) y nivel 2 (directors).
  const canReassign =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");

  function buildHref(extra: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    if (userFilter) params.set("user", userFilter);
    if (kindFilter) params.set("kind", kindFilter);
    Object.entries(extra).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    const q = params.toString();
    return q ? `/agenda?${q}` : "/agenda";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Calendario mensual + listado próximos 14 días
          </p>
        </div>
        <CreateAgendaButton teamMembers={team} />
      </div>

      {pendingMaintenanceCount > 0 && (
        <Link
          href="/mantenimientos/por-confirmar"
          className="block rounded-2xl border-2 border-blue-300 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-blue-700" />
            <h2 className="text-base font-bold text-blue-900">
              {pendingMaintenanceCount} mantenimiento
              {pendingMaintenanceCount === 1 ? "" : "s"} sin agendar en los
              próximos 30 días
            </h2>
          </div>
          <p className="mt-1 text-xs text-blue-800">
            Llama al cliente, confirma fecha y asigna técnico para que entren
            en la agenda. Pulsa para abrir la cola →
          </p>
        </Link>
      )}

      {unscheduled.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-5 w-5 text-amber-700" />
            <h2 className="text-base font-bold text-amber-900">
              Instalaciones sin agendar ({unscheduled.length})
            </h2>
          </div>
          <p className="mb-3 text-xs text-amber-800">
            Pendientes de programar fecha + instalador. Pulsa cada una para abrirla y agendarla.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/instalaciones/${it.id}` as never}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white p-3 hover:bg-amber-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {it.customer_name || "Sin cliente"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {it.reference_code ?? `#${it.id.slice(0, 8)}`}
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[it.status] ?? "secondary"}>
                    {STATUS_LABEL[it.status] ?? it.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        {view !== "calendar" && <input type="hidden" name="view" value={view} />}
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Asignado a</label>
          <select
            name="user"
            defaultValue={userFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {team.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Tipo</label>
          <select
            name="kind"
            defaultValue={kindFilter ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {KIND_FILTER_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </div>
        {/* Filtros adicionales solo en vista listado — no aplican al mes/semana. */}
        {view === "list" && (
          <>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Desde</label>
              <input
                type="date"
                name="from"
                defaultValue={
                  sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
                    ? sp.from
                    : `${listFrom.getFullYear()}-${String(listFrom.getMonth() + 1).padStart(2, "0")}-${String(listFrom.getDate()).padStart(2, "0")}`
                }
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Hasta</label>
              <input
                type="date"
                name="to"
                defaultValue={
                  sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)
                    ? sp.to
                    : `${listTo.getFullYear()}-${String(listTo.getMonth() + 1).padStart(2, "0")}-${String(listTo.getDate()).padStart(2, "0")}`
                }
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-muted-foreground">Estado</label>
              <select
                name="status"
                defaultValue={statusFilter ?? ""}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                <option value="scheduled">Programado</option>
                <option value="in_progress">En curso</option>
                <option value="completed">Completado</option>
                <option value="cancelled">Cancelado</option>
                <option value="no_show">No presentación</option>
                <option value="rescheduled">Reprogramado</option>
              </select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <label className="text-xs uppercase text-muted-foreground">Buscar</label>
              <input
                type="search"
                name="q"
                defaultValue={searchText}
                placeholder="Cliente, referencia…"
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
            </div>
            <input type="hidden" name="view" value="list" />
          </>
        )}
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(userFilter ||
          kindFilter ||
          (view === "list" && (sp.from || sp.to || statusFilter || searchText))) && (
          <Link
            href={view === "list" ? "/agenda?view=list" : "/agenda"}
            className="text-sm text-muted-foreground hover:underline"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="flex gap-2">
        <Link
          href={buildHref({ view: undefined }) as never}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold ${
            view === "calendar"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          <Calendar className="h-4 w-4" /> Mes
        </Link>
        <Link
          href={buildHref({ view: "week" }) as never}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold ${
            view === "week"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          <CalendarDays className="h-4 w-4" /> Semana
        </Link>
        <Link
          href={buildHref({ view: "list" }) as never}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border-2 px-4 text-sm font-semibold ${
            view === "list"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          <ListTodo className="h-4 w-4" /> Listado
        </Link>
      </div>

      {view === "calendar" && (
        <>
          <AgendaCalendar events={monthEvents} team={team} canReassign={canReassign} />
          <div className="space-y-3">
            <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Próximos 14 días ({events.length})
            </div>
            <DraggableAgendaList events={events} team={team} canReassign={canReassign} />
          </div>
        </>
      )}
      {view === "week" && (
        <AgendaWeekView
          events={weekEvents}
          team={team}
          canReassign={canReassign}
          weekStartIso={weekStart.toISOString()}
        />
      )}
      {view === "list" && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap text-sm">
            <span className="font-bold uppercase tracking-wider text-muted-foreground">
              {listFrom.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} —{" "}
              {listTo.toLocaleDateString("es-ES", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="text-muted-foreground">
              · {listEvents.length} tarea{listEvents.length === 1 ? "" : "s"}
              {searchText && listEvents.length !== listResult.events.length
                ? ` (filtradas de ${listResult.events.length})`
                : ""}
            </span>
          </div>
          {listResult.truncated && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Mostrando 500 de {listResult.total_before_limit}</strong> tareas.
              Reduce el rango de fechas o filtra por estado/tipo para verlas todas.
            </div>
          )}
          {listEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              Sin tareas en este rango.
            </p>
          ) : (
            <DraggableAgendaList
              events={listEvents}
              team={team}
              canReassign={canReassign}
            />
          )}
        </div>
      )}
    </div>
  );
}
