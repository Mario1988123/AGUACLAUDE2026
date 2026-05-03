"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { KIND_LABEL } from "./constants";
import type { AgendaItem } from "./actions";
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

export function AgendaWeekView({ events }: { events: AgendaItem[] }) {
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [moveTarget, setMoveTarget] = useState<AgendaItem | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekStart = days[0]!;
  const weekEnd = days[6]!;

  const eventsByDay: Record<string, AgendaItem[]> = {};
  for (const ev of events) {
    const d = new Date(ev.starts_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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

  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold capitalize">
          {weekStart.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} —{" "}
          {weekEnd.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
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

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[700px]">
          {/* Header */}
          <div className="border-b border-r bg-muted/30 px-2 py-2 text-[10px] uppercase font-bold text-muted-foreground">
            Hora
          </div>
          {days.map((d, i) => {
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
                <div
                  className={cn(
                    "text-sm font-extrabold",
                    isToday && "text-primary",
                  )}
                >
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
          eventId={moveTarget.id}
          currentStartsAt={moveTarget.starts_at}
          eventTitle={moveTarget.title}
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
}: {
  hour: number;
  days: Date[];
  eventsByDay: Record<string, AgendaItem[]>;
  onClickEvent: (ev: AgendaItem) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-muted/10 px-2 py-2 text-[11px] tabular-nums text-muted-foreground">
        {String(hour).padStart(2, "0")}:00
      </div>
      {days.map((d, i) => {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const evsAtHour = (eventsByDay[key] ?? []).filter((ev) => {
          const t = new Date(ev.starts_at);
          return t.getHours() === hour;
        });
        return (
          <div
            key={i}
            className="border-b border-r last:border-r-0 min-h-[44px] p-1 space-y-0.5"
          >
            {evsAtHour.map((ev) => (
              <button
                type="button"
                key={ev.id}
                onClick={() => onClickEvent(ev)}
                className={cn(
                  "block w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold hover:opacity-80 cursor-pointer",
                  KIND_COLOR[ev.kind] ?? KIND_COLOR.manual,
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
