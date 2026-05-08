import Link from "next/link";
import { listAgenda, listAgendaMonth, listTeamMembers } from "@/modules/agenda/actions";
import { KIND_LABEL } from "@/modules/agenda/constants";
import { CreateAgendaButton } from "@/modules/agenda/create-form";
import { AgendaCalendar } from "@/modules/agenda/calendar";
import { DraggableAgendaList } from "@/modules/agenda/draggable-list";
import { AgendaWeekView } from "@/modules/agenda/week-view";
import { listUnscheduledInstallations } from "@/modules/installations/actions";
import { STATUS_LABEL, STATUS_VARIANT } from "@/modules/installations/constants";
import { Badge } from "@/shared/ui/badge";
import { requireSession } from "@/shared/lib/auth/session";
import { Calendar, ListTodo, CalendarDays, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const KIND_FILTER_OPTIONS = ["visit", "call", "manual", "meeting", "reminder"] as const;

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; kind?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const userFilter = sp.user || undefined;
  const kindFilter =
    sp.kind && KIND_FILTER_OPTIONS.includes(sp.kind as never) ? sp.kind : undefined;
  const view: "calendar" | "week" | "list" =
    sp.view === "list" ? "list" : sp.view === "week" ? "week" : "calendar";

  const now = new Date();
  const [events, monthEvents, team, session, unscheduled] = await Promise.all([
    listAgenda(14, { user_id: userFilter, kind: kindFilter }),
    listAgendaMonth(now.getFullYear(), now.getMonth()),
    listTeamMembers(),
    requireSession(),
    listUnscheduledInstallations().catch(() => []),
  ]);
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
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(userFilter || kindFilter) && (
          <Link href="/agenda" className="text-sm text-muted-foreground hover:underline">
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
        <AgendaWeekView events={events} team={team} canReassign={canReassign} />
      )}
      {view === "list" && (
        <div className="space-y-3">
          <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Listado próximos 14 días ({events.length})
          </div>
          <DraggableAgendaList events={events} team={team} canReassign={canReassign} />
        </div>
      )}
    </div>
  );
}
