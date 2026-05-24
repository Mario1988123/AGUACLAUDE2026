"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { rescheduleAgendaEventSafeAction, markAgendaEventDoneAction } from "./actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT } from "./constants";
import type { AgendaItem } from "./actions";
import { MoveEventDialog } from "./move-event-dialog";

interface Props {
  events: AgendaItem[];
  team?: { user_id: string; full_name: string }[];
  canReassign?: boolean;
}

/**
 * "YYYY-MM-DD" en HORA LOCAL. NO usar slice(0,10) sobre el ISO UTC porque
 * desfasa el día cuando la hora cae cerca de medianoche (España UTC+1/+2).
 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Lista de agenda agrupada por día con drag-and-drop nativo HTML5 para
 * arrastrar tarjetas de un día a otro. Conserva la hora original; si quieres
 * cambiar la hora, edita el evento.
 */
export function DraggableAgendaList({ events: initial, team = [], canReassign = false }: Props) {
  const [events, setEvents] = useState(initial);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<AgendaItem | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const userNameMap = useMemo(
    () => new Map(team.map((u) => [u.user_id, u.full_name])),
    [team],
  );

  const byDay = events.reduce<Record<string, AgendaItem[]>>((acc, ev) => {
    const day = localDateKey(new Date(ev.starts_at));
    (acc[day] = acc[day] ?? []).push(ev);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();

  function onDragStart(e: React.DragEvent<HTMLLIElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", id);
    } catch {
      /* algunos browsers móvil no soportan, lo gestionamos por state */
    }
  }
  function onDragEnd() {
    setDraggingId(null);
    setOverDay(null);
  }
  function onDragOverDay(e: React.DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overDay !== day) setOverDay(day);
  }
  function onDropDay(e: React.DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    const id = draggingId ?? e.dataTransfer.getData("text/plain");
    if (!id) return;
    const ev = events.find((x) => x.id === id);
    if (!ev) return;
    const currentDay = localDateKey(new Date(ev.starts_at));
    if (currentDay === day) {
      setOverDay(null);
      return;
    }
    // Mantener hora original, sólo cambiar fecha
    const oldDate = new Date(ev.starts_at);
    const [y, m, d] = day.split("-").map(Number);
    const newDate = new Date(
      y!,
      (m ?? 1) - 1,
      d!,
      oldDate.getHours(),
      oldDate.getMinutes(),
      0,
    );
    const newIso = newDate.toISOString();

    // Optimistic update
    setEvents((prev) =>
      prev.map((x) => (x.id === id ? { ...x, starts_at: newIso } : x)),
    );
    setOverDay(null);

    startTransition(async () => {
      const r = await rescheduleAgendaEventSafeAction(id, newIso);
      if (!r.ok) {
        notify.error("No se pudo reagendar", r.error);
        setEvents(initial);
        return;
      }
      notify.success("Evento reagendado");
      router.refresh();
    });
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Sin eventos en los próximos 14 días.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        💡 Pulsa cualquier tarjeta para reagendarla (fecha + hora). En escritorio también puedes arrastrarla a otro día.
      </p>
      {days.map((day) => (
        <div
          key={day}
          onDragOver={(e) => onDragOverDay(e, day)}
          onDragLeave={() => setOverDay(null)}
          onDrop={(e) => onDropDay(e, day)}
          className={overDay === day ? "ring-2 ring-primary rounded-2xl" : ""}
        >
          <Card>
            <CardHeader>
              <CardTitle className="capitalize">
                {new Date(day + "T00:00:00").toLocaleDateString("es-ES", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {byDay[day]!
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  .map((ev) => {
                    // Items virtuales (instalaciones/mantenimientos) SÍ son
                    // draggable. rescheduleAgendaEventAction detecta prefijo
                    // "virtual-inst-"/"virtual-maint-" y actualiza la tabla
                    // origen (installations / maintenance_jobs).

                    // Marcador visual (decisión usuario 2026-05-24):
                    //  · verde → completada
                    //  · rojo  → vencida (scheduled/in_progress con fecha < ahora)
                    //  · gris  → futura
                    const startsMs = new Date(ev.starts_at).getTime();
                    const isOverdue =
                      (ev.status === "scheduled" || ev.status === "in_progress") &&
                      startsMs < Date.now();
                    const stateBorder =
                      ev.status === "completed"
                        ? "border-l-4 border-emerald-500"
                        : isOverdue
                          ? "border-l-4 border-red-500"
                          : "border-l-4 border-transparent";
                    return (
                    <li
                      key={ev.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, ev.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => setMoveTarget(ev)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setMoveTarget(ev);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={
                        ev.status === "completed"
                          ? "Tarea completada"
                          : isOverdue
                            ? "Tarea vencida — pasada de fecha sin completar"
                            : undefined
                      }
                      className={`flex items-start gap-3 py-3 pl-3 -ml-1 cursor-pointer hover:bg-muted/40 rounded-lg pr-2 -mr-2 transition-all ${stateBorder} ${
                        draggingId === ev.id ? "opacity-40" : ""
                      }`}
                    >
                      <GripVertical className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="w-20 shrink-0 text-sm font-bold tabular-nums text-primary">
                        {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="flex-1 min-w-0">
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
                          <p className="mt-1 text-xs text-muted-foreground">
                            {ev.description}
                          </p>
                        )}
                      </div>
                      {/* Botón "Marcar hecha" para eventos manuales/visit/call,
                          no virtuales (esos se cierran desde su wizard). */}
                      {ev.status !== "completed" &&
                        ev.status !== "cancelled" &&
                        !ev.id.startsWith("virtual-") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-xs text-emerald-700 hover:bg-emerald-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              startTransition(async () => {
                                const r = await markAgendaEventDoneAction(ev.id);
                                if (!r.ok) {
                                  notify.error("No se pudo marcar", r.error);
                                  return;
                                }
                                notify.success("Tarea marcada como hecha");
                                router.refresh();
                              });
                            }}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Hecha
                          </Button>
                        )}
                    </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        </div>
      ))}

      {moveTarget && (
        <MoveEventDialog
          open={moveTarget !== null}
          onOpenChange={(o) => {
            if (!o) setMoveTarget(null);
          }}
          event={moveTarget}
          team={team}
          canReassign={canReassign}
          userNameMap={userNameMap}
        />
      )}
    </div>
  );
}
