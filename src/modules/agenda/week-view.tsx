"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { notify } from "@/shared/hooks/use-toast";
import { KIND_LABEL } from "./constants";
import type { AgendaItem } from "./actions";
import { rescheduleAgendaEventAction } from "./actions";
import { MoveEventDialog } from "./move-event-dialog";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 08:00 → 19:00

const KIND_COLOR: Record<string, string> = {
  visit: "bg-[#e6e6ff] text-[#5a5acf]",
  installation: "bg-[#dcf6e6] text-[#0caf60]",
  maintenance: "bg-[#ffe9c8] text-[#cf8c1a]",
  call: "bg-[#dde7ff] text-[#3b82f6]",
  reminder: "bg-[#f4d8ff] text-[#9333ea]",
  manual: "bg-[#fde2e2] text-[#cf2727]",
  incident_followup: "bg-[#ffe1e1] text-[#cf2727]",
  meeting: "bg-[#d8f0ff] text-[#0891b2]",
};

function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // lunes=0
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return r;
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface Props {
  events: AgendaItem[];
  team?: { user_id: string; full_name: string }[];
  canReassign?: boolean;
}

export function AgendaWeekView({ events: initial, team = [], canReassign = false }: Props) {
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [moveTarget, setMoveTarget] = useState<AgendaItem | null>(null);
  const [events, setEvents] = useState<AgendaItem[]>(initial);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const userNameMap = useMemo(
    () => new Map(team.map((u) => [u.user_id, u.full_name])),
    [team],
  );

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekStart = days[0]!;
  const weekEnd = days[6]!;

  // Eventos de esta semana (rango)
  const weekEvents = useMemo(() => {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(weekEnd);
    end.setHours(23, 59, 59, 999);
    return events.filter((ev) => {
      const t = new Date(ev.starts_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
  }, [events, weekStart, weekEnd]);

  const outsideHoursEvents = useMemo(
    () => weekEvents.filter((ev) => ev.is_outside_hours),
    [weekEvents],
  );

  const eventsByDay: Record<string, AgendaItem[]> = {};
  for (const ev of events) {
    const d = new Date(ev.starts_at);
    const key = localKey(d);
    (eventsByDay[key] = eventsByDay[key] ?? []).push(ev);
  }

  function prev() {
    const r = new Date(cursor);
    r.setDate(r.getDate() - 7);
    setCursor(r);
  }
  function next() {
    const r = new Date(cursor);
    r.setDate(r.getDate() + 7);
    setCursor(r);
  }
  function today() {
    setCursor(startOfWeek(new Date()));
  }

  const todayKey = localKey(new Date());

  function onDragStart(e: React.DragEvent<HTMLButtonElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", id);
    } catch {
      /* no-op */
    }
  }
  function onDragEnd() {
    setDraggingId(null);
    setOverCell(null);
  }
  function onDragOverCell(e: React.DragEvent<HTMLDivElement>, cell: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overCell !== cell) setOverCell(cell);
  }
  function onDropCell(e: React.DragEvent<HTMLDivElement>, day: Date, hour: number) {
    e.preventDefault();
    setOverCell(null);
    const id = draggingId ?? e.dataTransfer.getData("text/plain");
    if (!id) return;
    const ev = events.find((x) => x.id === id);
    if (!ev) return;
    const oldDate = new Date(ev.starts_at);
    if (
      oldDate.getFullYear() === day.getFullYear() &&
      oldDate.getMonth() === day.getMonth() &&
      oldDate.getDate() === day.getDate() &&
      oldDate.getHours() === hour
    )
      return; // mismo slot

    const newDate = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour,
      oldDate.getMinutes(),
      0,
    );
    const newIso = newDate.toISOString();

    // Optimistic update
    const prevSnapshot = events;
    setEvents((cur) => cur.map((x) => (x.id === id ? { ...x, starts_at: newIso } : x)));

    startTransition(async () => {
      try {
        await rescheduleAgendaEventAction(id, newIso);
        notify.success("Tarea reagendada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
        setEvents(prevSnapshot);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold capitalize">
          {weekStart.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} —{" "}
          {weekEnd.toLocaleDateString("es-ES", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={today}>
            Esta semana
          </Button>
          <Button variant="outline" size="icon" onClick={prev} aria-label="Semana anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={next} aria-label="Semana siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Banner de fuera de horario */}
      {outsideHoursEvents.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {outsideHoursEvents.length} tarea
            {outsideHoursEvents.length > 1 ? "s" : ""} fuera de horario esta semana
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {outsideHoursEvents.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => setMoveTarget(ev)}
                  className="text-left hover:underline"
                >
                  ·{" "}
                  {new Date(ev.starts_at).toLocaleString("es-ES", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  — <strong>{ev.title}</strong>{" "}
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    {KIND_LABEL[ev.kind] ?? ev.kind}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        💡 Pulsa una tarea para ver el detalle, reagendarla o reasignarla. Arrastra
        cualquier tarea a otra hora/día para moverla rápido.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[700px]">
          {/* Header */}
          <div className="border-b border-r bg-muted/30 px-2 py-2 text-[10px] uppercase font-bold text-muted-foreground">
            Hora
          </div>
          {days.map((d, i) => {
            const key = localKey(d);
            const isToday = key === todayKey;
            return (
              <div
                key={i}
                className={cn(
                  "border-b border-r last:border-r-0 px-2 py-2 text-center",
                  isToday ? "bg-primary/10" : "bg-muted/30",
                )}
              >
                <div className="text-[10px] uppercase font-bold text-muted-foreground">
                  {WEEKDAYS[i]}
                </div>
                <div className={cn("text-sm font-extrabold", isToday && "text-primary")}>
                  {d.getDate()}
                </div>
              </div>
            );
          })}

          {/* Filas de horas */}
          {HOURS.map((h) => (
            <FragmentRow
              key={h}
              hour={h}
              days={days}
              eventsByDay={eventsByDay}
              onClickEvent={setMoveTarget}
              draggingId={draggingId}
              overCell={overCell}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverCell={onDragOverCell}
              onDropCell={onDropCell}
            />
          ))}
        </div>
      </div>

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

function FragmentRow({
  hour,
  days,
  eventsByDay,
  onClickEvent,
  draggingId,
  overCell,
  onDragStart,
  onDragEnd,
  onDragOverCell,
  onDropCell,
}: {
  hour: number;
  days: Date[];
  eventsByDay: Record<string, AgendaItem[]>;
  onClickEvent: (ev: AgendaItem) => void;
  draggingId: string | null;
  overCell: string | null;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onDragEnd: () => void;
  onDragOverCell: (e: React.DragEvent<HTMLDivElement>, cell: string) => void;
  onDropCell: (e: React.DragEvent<HTMLDivElement>, day: Date, hour: number) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-muted/10 px-2 py-2 text-[11px] tabular-nums text-muted-foreground">
        {String(hour).padStart(2, "0")}:00
      </div>
      {days.map((d, i) => {
        const key = localKey(d);
        const cellId = `${key}-${hour}`;
        const evsAtHour = (eventsByDay[key] ?? []).filter((ev) => {
          const t = new Date(ev.starts_at);
          return t.getHours() === hour;
        });
        const isOver = overCell === cellId;
        return (
          <div
            key={i}
            onDragOver={(e) => onDragOverCell(e, cellId)}
            onDrop={(e) => onDropCell(e, d, hour)}
            className={cn(
              "border-b border-r last:border-r-0 min-h-[44px] p-1 space-y-0.5 transition-colors",
              isOver && "bg-primary/10 ring-1 ring-primary",
            )}
          >
            {evsAtHour.map((ev) => (
              <button
                type="button"
                key={ev.id}
                draggable
                onDragStart={(e) => onDragStart(e, ev.id)}
                onDragEnd={onDragEnd}
                onClick={() => onClickEvent(ev)}
                className={cn(
                  "block w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold hover:opacity-80 cursor-pointer",
                  KIND_COLOR[ev.kind] ?? KIND_COLOR.manual,
                  draggingId === ev.id && "opacity-40",
                  ev.is_outside_hours && "ring-1 ring-amber-400",
                )}
                title={`${KIND_LABEL[ev.kind] ?? ev.kind}: ${ev.title}`}
              >
                {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                {ev.title}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
