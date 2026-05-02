"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { KIND_LABEL } from "./constants";
import type { AgendaItem } from "./actions";

interface Props {
  events: AgendaItem[];
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const KIND_COLOR: Record<string, string> = {
  visit: "bg-primary/15 text-primary",
  installation: "bg-success/15 text-success",
  maintenance: "bg-warning/15 text-warning",
  call: "bg-secondary text-secondary-foreground",
  reminder: "bg-muted text-muted-foreground",
  manual: "bg-muted text-muted-foreground",
  incident_followup: "bg-destructive/15 text-destructive",
  meeting: "bg-primary/15 text-primary",
};

export function AgendaCalendar({ events }: Props) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Lunes = 0
  const offset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;

  const eventsByDay: Record<string, AgendaItem[]> = {};
  for (const ev of events) {
    const d = ev.starts_at.slice(0, 10);
    (eventsByDay[d] = eventsByDay[d] ?? []).push(ev);
  }

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  function prev() {
    setCursor(new Date(year, month - 1, 1));
  }
  function next() {
    setCursor(new Date(year, month + 1, 1));
  }
  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold capitalize">
            {MONTHS[month]} {year}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" onClick={prev} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={next} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-3">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }).map((_, i) => {
            const dayNum = i - offset + 1;
            const inMonth = dayNum >= 1 && dayNum <= lastDay.getDate();
            const date = inMonth ? new Date(year, month, dayNum) : null;
            const key = date ? date.toISOString().slice(0, 10) : "";
            const dayEvents = key ? eventsByDay[key] ?? [] : [];
            const isToday = key === todayKey;

            return (
              <div
                key={i}
                className={cn(
                  "min-h-24 border-b border-r border-border p-2 last:border-r-0",
                  !inMonth && "bg-muted/20",
                  isToday && "bg-primary/5",
                )}
              >
                {inMonth && (
                  <>
                    <div
                      className={cn(
                        "mb-1 text-xs font-bold",
                        isToday
                          ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          : "text-foreground",
                      )}
                    >
                      {dayNum}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <div
                          key={ev.id}
                          className={cn(
                            "truncate rounded-md px-1.5 py-1 text-[10px] font-semibold",
                            KIND_COLOR[ev.kind] ?? KIND_COLOR.manual,
                          )}
                          title={`${KIND_LABEL[ev.kind]}: ${ev.title}`}
                        >
                          {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          {ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{dayEvents.length - 3}
                        </Badge>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <span
            key={k}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold", c)}
          >
            <span className="h-2 w-2 rounded-full bg-current" />
            {KIND_LABEL[k] ?? k}
          </span>
        ))}
      </div>
    </div>
  );
}
