"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { KIND_LABEL } from "./constants";
import type { AgendaItem } from "./actions";
import { MoveEventDialog } from "./move-event-dialog";

interface Props {
  events: AgendaItem[];
  team?: { user_id: string; full_name: string }[];
  canReassign?: boolean;
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

/**
 * Devuelve "YYYY-MM-DD" en HORA LOCAL del navegador. NO usar
 * toISOString().slice(0,10) — convierte a UTC y desfasa el día cuando
 * la hora está cerca de medianoche (España UTC+1/+2 → un evento del 5
 * mayo a las 01:00h local sale como 4 mayo en UTC, así que el calendario
 * lo pintaba un día antes).
 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
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

// Paleta pastel estilo DashStack — bloques tipo Glastonbury/Design Conference
const KIND_COLOR: Record<string, string> = {
  visit: "bg-[#e6e6ff] text-[#5a5acf]", // lila
  installation: "bg-[#dcf6e6] text-[#0caf60]", // verde
  maintenance: "bg-[#ffe9c8] text-[#cf8c1a]", // naranja
  call: "bg-[#dde7ff] text-[#3b82f6]", // azul
  reminder: "bg-[#f4d8ff] text-[#9333ea]", // morado
  manual: "bg-[#fde2e2] text-[#cf2727]", // rosa
  incident_followup: "bg-[#ffe1e1] text-[#cf2727]", // rojo suave
  meeting: "bg-[#d8f0ff] text-[#0891b2]", // cyan
};

export function AgendaCalendar({ events, team = [], canReassign = false }: Props) {
  const userNameMap = useMemo(
    () => new Map(team.map((u) => [u.user_id, u.full_name])),
    [team],
  );
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [moveTarget, setMoveTarget] = useState<AgendaItem | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Lunes = 0
  const offset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((offset + lastDay.getDate()) / 7) * 7;

  const eventsByDay: Record<string, AgendaItem[]> = {};
  for (const ev of events) {
    // Convertimos el ISO UTC a fecha local antes de extraer YYYY-MM-DD
    const d = localDateKey(new Date(ev.starts_at));
    (eventsByDay[d] = eventsByDay[d] ?? []).push(ev);
  }

  const today = new Date();
  const todayKey = localDateKey(today);

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
            const key = date ? localDateKey(date) : "";
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
                      {dayEvents.slice(0, 3).map((ev) => {
                        // Virtual (installation / maintenance directos) →
                        // navega a la ficha, no abrir move-dialog.
                        const isVirtual = ev.id.startsWith("virtual-");
                        const virtualHref =
                          isVirtual && ev.subject_type === "installation"
                            ? `/instalaciones/${ev.subject_id}`
                            : isVirtual && ev.subject_type === "maintenance"
                              ? `/mantenimientos/${ev.subject_id}`
                              : null;
                        return (
                        <button
                          type="button"
                          key={ev.id}
                          onClick={() => {
                            if (virtualHref) {
                              window.location.href = virtualHref;
                            } else {
                              setMoveTarget(ev);
                            }
                          }}
                          className={cn(
                            "block w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold hover:opacity-80 hover:ring-1 hover:ring-current cursor-pointer",
                            KIND_COLOR[ev.kind] ?? KIND_COLOR.manual,
                          )}
                          title={`${KIND_LABEL[ev.kind]}: ${ev.title}${
                            isVirtual ? " — abrir ficha" : " — pulsa para mover"
                          }`}
                        >
                          {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          {ev.title}
                        </button>
                        );
                      })}
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
