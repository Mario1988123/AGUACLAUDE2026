import { listAgenda } from "@/modules/agenda/actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT } from "@/modules/agenda/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export default async function AgendaPage() {
  const events = await listAgenda(14);
  // Agrupar por día
  const byDay = events.reduce<Record<string, typeof events>>((acc, ev) => {
    const day = ev.starts_at.slice(0, 10);
    (acc[day] = acc[day] ?? []).push(ev);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agenda</h1>
        <p className="text-sm text-muted-foreground">Próximos 14 días · {events.length} eventos</p>
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
                  <li key={ev.id} className="flex items-start gap-3 py-3">
                    <div className="w-20 shrink-0 text-sm tabular-nums text-muted-foreground">
                      {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{ev.title}</span>
                        <Badge variant="outline">{KIND_LABEL[ev.kind] ?? ev.kind}</Badge>
                        <Badge variant={STATUS_VARIANT[ev.status]}>
                          {STATUS_LABEL[ev.status] ?? ev.status}
                        </Badge>
                        {ev.is_outside_hours && (
                          <Badge variant="warning">Fuera horario</Badge>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
