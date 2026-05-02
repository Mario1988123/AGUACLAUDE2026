import { listAgenda, listAgendaMonth, listTeamMembers } from "@/modules/agenda/actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT } from "@/modules/agenda/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CreateAgendaButton } from "@/modules/agenda/create-form";
import { AgendaCalendar } from "@/modules/agenda/calendar";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const now = new Date();
  const [events, monthEvents, team] = await Promise.all([
    listAgenda(14),
    listAgendaMonth(now.getFullYear(), now.getMonth()),
    listTeamMembers(),
  ]);
  const byDay = events.reduce<Record<string, typeof events>>((acc, ev) => {
    const day = ev.starts_at.slice(0, 10);
    (acc[day] = acc[day] ?? []).push(ev);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Calendario mensual + lista próximos 14 días
          </p>
        </div>
        <CreateAgendaButton teamMembers={team} />
      </div>

      <AgendaCalendar events={monthEvents} />

      <div className="space-y-3">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Próximos 14 días ({events.length})
        </div>
        {days.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Sin eventos en los próximos 14 días.
            </CardContent>
          </Card>
        ) : (
          days.map((day) => (
            <Card key={day}>
              <CardHeader>
                <CardTitle className="capitalize">
                  {new Date(day).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {byDay[day]!.map((ev) => (
                    <li key={ev.id} className="flex items-start gap-4 py-4">
                      <div className="w-24 shrink-0 text-sm font-bold tabular-nums text-primary">
                        {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{ev.title}</span>
                          <Badge variant="outline">{KIND_LABEL[ev.kind] ?? ev.kind}</Badge>
                          <Badge variant={STATUS_VARIANT[ev.status]}>
                            {STATUS_LABEL[ev.status] ?? ev.status}
                          </Badge>
                          {ev.is_outside_hours && (
                            <Badge variant="warning">Fuera horario</Badge>
                          )}
                        </div>
                        {ev.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{ev.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
