"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { submitAbsenceAction } from "./absences-actions";

interface HolidayLite {
  date: string;
  name: string;
}
interface WindowLite {
  starts_on: string;
  ends_on: string;
  label: string;
  max_concurrent_users: number | null;
}
interface AbsenceLite {
  starts_on: string;
  ends_on: string;
  status: string;
  kind: string;
}

interface Props {
  holidays: HolidayLite[];
  vacationWindows: WindowLite[];
  myAbsences: AbsenceLite[];
  /** Días restantes de vacaciones para mostrar arriba. */
  vacationRemaining: number;
  vacationTotal: number;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  return new Date(s + "T00:00:00");
}

function inRange(d: Date, from: Date, to: Date): boolean {
  return d >= from && d <= to;
}

export function VacationCalendarModal({
  holidays,
  vacationWindows,
  myAbsences,
  vacationRemaining,
  vacationTotal,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const holidayMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidays) m.set(h.date, h.name);
    return m;
  }, [holidays]);

  const myAbsenceMap = useMemo(() => {
    const m = new Map<string, { kind: string; status: string }>();
    for (const a of myAbsences) {
      const start = parseYmd(a.starts_on);
      const end = parseYmd(a.ends_on);
      const cur = new Date(start);
      while (cur <= end) {
        m.set(ymd(cur), { kind: a.kind, status: a.status });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return m;
  }, [myAbsences]);

  function inAnyWindow(d: Date): WindowLite | null {
    for (const w of vacationWindows) {
      const s = parseYmd(w.starts_on);
      const e = parseYmd(w.ends_on);
      if (inRange(d, s, e)) return w;
    }
    return null;
  }

  // Genera el grid del mes actual (6 semanas, lunes-domingo)
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = (first.getDay() + 6) % 7; // lunes = 0
    const start = new Date(first);
    start.setDate(start.getDate() - startDow);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  function cellClick(d: Date) {
    const s = ymd(d);
    if (!from || (from && to)) {
      setFrom(s);
      setTo(null);
      return;
    }
    // Si ya hay from y no to, fijar to (orden ascendente)
    if (s < from) {
      setTo(from);
      setFrom(s);
    } else {
      setTo(s);
    }
  }

  function reset() {
    setFrom(null);
    setTo(null);
    setNotes("");
  }

  function submit() {
    if (!from) {
      notify.warning("Selecciona fecha de inicio");
      return;
    }
    const realTo = to ?? from;
    startTransition(async () => {
      const r = await submitAbsenceAction({
        kind: "vacation",
        starts_on: from,
        ends_on: realTo,
        notes: notes || undefined,
      });
      if (!r.ok) {
        notify.error("No se pudo solicitar", r.error);
        return;
      }
      notify.success(
        "Solicitud enviada",
        "El admin la revisará y te llegará una notificación.",
      );
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  const monthLabel = cursor.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
  const todayStr = ymd(new Date());

  // Días seleccionados (rango from→to incluido)
  function isSelected(d: Date): boolean {
    const s = ymd(d);
    if (!from) return false;
    if (!to) return s === from;
    return s >= from && s <= to;
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <CalendarDays className="h-4 w-4" /> Calendario laboral
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-lg font-bold">Calendario laboral</h2>
                <p className="text-xs text-muted-foreground">
                  Te quedan{" "}
                  <strong className="text-emerald-600">
                    {vacationRemaining}
                  </strong>{" "}
                  de {vacationTotal} días de vacaciones este año.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-2 text-[11px]">
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm bg-red-100 border border-red-300" />
                Festivo
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm bg-amber-100 border border-amber-300" />
                Ventana vacacional
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm bg-emerald-100 border border-emerald-300" />
                Tu ausencia aprobada
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm bg-blue-100 border border-blue-300" />
                Tu ausencia pendiente
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm bg-primary border border-primary" />
                Selección
              </span>
            </div>

            {/* Nav meses */}
            <div className="flex items-center justify-between border-b px-4 py-2">
              <button
                onClick={() =>
                  setCursor(
                    new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
                  )
                }
                className="rounded-md p-1 hover:bg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-bold capitalize tabular-nums">
                {monthLabel}
              </div>
              <button
                onClick={() =>
                  setCursor(
                    new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
                  )
                }
                className="rounded-md p-1 hover:bg-muted"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Grid días */}
            <div className="p-4">
              <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
                {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {grid.map((d, i) => {
                  const ds = ymd(d);
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const hol = holidayMap.get(ds);
                  const win = inAnyWindow(d);
                  const absence = myAbsenceMap.get(ds);
                  const selected = isSelected(d);
                  const isToday = ds === todayStr;
                  const weekend = d.getDay() === 0 || d.getDay() === 6;

                  let bg = "";
                  let border = "border";
                  if (selected) {
                    bg = "bg-primary text-primary-foreground border-primary";
                  } else if (absence) {
                    bg =
                      absence.status === "approved"
                        ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                        : "bg-blue-100 text-blue-900 border-blue-300";
                  } else if (hol) {
                    bg = "bg-red-100 text-red-900 border-red-300";
                  } else if (win) {
                    bg = "bg-amber-100 text-amber-900 border-amber-300";
                  } else if (weekend) {
                    bg = "bg-muted/40 text-muted-foreground";
                  }
                  if (!inMonth) bg = `${bg} opacity-40`;
                  if (isToday && !selected) border = "border-2 border-primary";

                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => cellClick(d)}
                      title={
                        hol
                          ? hol
                          : win
                            ? `Ventana: ${win.label}${win.max_concurrent_users != null ? ` (máx ${win.max_concurrent_users})` : ""}`
                            : absence
                              ? `Tu ${absence.kind} (${absence.status})`
                              : ""
                      }
                      className={`flex aspect-square items-center justify-center rounded-md text-xs font-bold ${border} ${bg} hover:opacity-80`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Form solicitud */}
            <div className="space-y-3 border-t bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">
                Pulsa el día de inicio y luego el día de fin para seleccionar
                un rango. Si solo es un día, pulsa dos veces el mismo.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Desde</Label>
                  <Input
                    type="date"
                    value={from ?? ""}
                    onChange={(e) => setFrom(e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Hasta</Label>
                  <Input
                    type="date"
                    value={to ?? ""}
                    onChange={(e) => setTo(e.target.value || null)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notas (opcional)</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  disabled={pending || !from}
                >
                  Limpiar
                </Button>
                <Button
                  size="sm"
                  variant="success"
                  onClick={submit}
                  disabled={pending || !from}
                  className="gap-2"
                >
                  <Check className="h-4 w-4" />
                  {pending ? "Enviando..." : "Solicitar vacaciones"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
