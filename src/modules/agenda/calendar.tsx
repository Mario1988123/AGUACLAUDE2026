"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";
import { notify } from "@/shared/hooks/use-toast";
import { KIND_LABEL } from "./constants";
import type { AgendaItem } from "./actions";
import { rescheduleAgendaEventSafeAction } from "./actions";
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
/** Lunes de la semana de `d` (lunes = inicio de semana). */
function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // lunes = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
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
  uninstall: "bg-[#ffe0d0] text-[#c2410c]", // teja (RETIRADA)
  maintenance: "bg-[#ffe9c8] text-[#cf8c1a]", // naranja
  call: "bg-[#dde7ff] text-[#3b82f6]", // azul
  reminder: "bg-[#f4d8ff] text-[#9333ea]", // morado
  manual: "bg-[#fde2e2] text-[#cf2727]", // rosa
  incident_followup: "bg-[#ffe1e1] text-[#cf2727]", // rojo suave
  meeting: "bg-[#d8f0ff] text-[#0891b2]", // cyan
};

export function AgendaCalendar({ events, team = [], canReassign = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Doble-clic en un día (vista mes) → abre la SEMANA de ese día, conservando
  // los filtros actuales (usuario/tipo).
  function goToWeek(d: Date) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("view", "week");
    params.set("w", localDateKey(startOfWeek(d)));
    router.push(`/agenda?${params.toString()}` as never);
  }
  const userNameMap = useMemo(
    () => new Map(team.map((u) => [u.user_id, u.full_name])),
    [team],
  );
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [moveTarget, setMoveTarget] = useState<AgendaItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  function handleDragStart(ev: AgendaItem, e: React.DragEvent) {
    if (pending) return;
    setDraggingId(ev.id);
    e.dataTransfer.setData("text/plain", ev.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(key: string, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  }

  function handleDrop(targetKey: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOverKey(null);
    const eventId = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (!eventId) return;
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const originalKey = localDateKey(new Date(ev.starts_at));
    if (originalKey === targetKey) return;
    // Construir nueva fecha conservando hora original local
    const [yy, mm, dd] = targetKey.split("-").map(Number);
    const orig = new Date(ev.starts_at);
    const newDate = new Date(yy!, (mm ?? 1) - 1, dd!, orig.getHours(), orig.getMinutes(), 0);
    startTransition(async () => {
      const r = await rescheduleAgendaEventSafeAction(ev.id, newDate.toISOString());
      if (!r.ok) {
        notify.error("No se pudo mover", r.error);
        return;
      }
      notify.success(
        `Movido a ${newDate.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`,
      );
      router.refresh();
    });
  }

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
                onDragOver={inMonth ? (e) => handleDragOver(key, e) : undefined}
                onDragLeave={() => dragOverKey === key && setDragOverKey(null)}
                onDrop={inMonth ? (e) => handleDrop(key, e) : undefined}
                onDoubleClick={inMonth && date ? () => goToWeek(date) : undefined}
                title={inMonth ? "Doble clic para ver esta semana" : undefined}
                className={cn(
                  "min-h-24 border-b border-r border-border p-2 last:border-r-0 transition-colors",
                  inMonth && "cursor-pointer",
                  !inMonth && "bg-muted/20",
                  isToday && "bg-primary/5",
                  dragOverKey === key && "bg-primary/20 ring-2 ring-primary ring-inset",
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
                        <button
                          type="button"
                          key={ev.id}
                          draggable={!pending}
                          onDragStart={(e) => handleDragStart(ev, e)}
                          onDragEnd={() => setDraggingId(null)}
                          onClick={() => setMoveTarget(ev)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className={cn(
                            "block w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold hover:opacity-80 hover:ring-1 hover:ring-current cursor-grab active:cursor-grabbing",
                            KIND_COLOR[ev.kind] ?? KIND_COLOR.manual,
                            draggingId === ev.id && "opacity-40",
                          )}
                          title={`${KIND_LABEL[ev.kind]}: ${ev.title} — arrastra para mover o pulsa para reagendar`}
                        >
                          {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          {ev.title}
                        </button>
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

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          💡 Tip: arrastra un evento a otro día para reagendarlo (conserva la
          hora). Pulsa el evento para abrir el detalle. Doble clic en un día para
          ver esa semana en detalle.
        </p>
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
