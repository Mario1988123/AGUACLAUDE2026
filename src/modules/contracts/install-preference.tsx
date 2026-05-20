"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon, CalendarClock, Save, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { saveInstallPreferenceSafeAction } from "./actions";

type Slot = "morning" | "afternoon" | "any" | "custom";

const SLOTS: Array<{ value: Slot; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "morning", label: "Mañana (9–14h)", icon: Sun },
  { value: "afternoon", label: "Tarde (16–20h)", icon: Moon },
  { value: "any", label: "Cualquier hora", icon: CalendarClock },
  { value: "custom", label: "Otra (texto)", icon: CalendarClock },
];

const DOWS: Array<{ value: number; short: string; full: string }> = [
  { value: 1, short: "L", full: "Lunes" },
  { value: 2, short: "M", full: "Martes" },
  { value: 3, short: "X", full: "Miércoles" },
  { value: 4, short: "J", full: "Jueves" },
  { value: 5, short: "V", full: "Viernes" },
  { value: 6, short: "S", full: "Sábado" },
  { value: 7, short: "D", full: "Domingo" },
];

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function MultiDateCalendar({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState<{ y: number; m: number }>({
    y: today.getFullYear(),
    m: today.getMonth(),
  });
  const first = new Date(cursor.y, cursor.m, 1);
  const last = new Date(cursor.y, cursor.m + 1, 0);
  // Lunes=0
  const startDow = (first.getDay() + 6) % 7;
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const todayIso = toISO(today);

  function toggle(d: Date) {
    if (disabled) return;
    const iso = toISO(d);
    if (value.includes(iso)) onChange(value.filter((x) => x !== iso));
    else onChange([...value, iso].sort());
  }

  return (
    <div className="rounded-xl border-2 border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            setCursor((c) => ({
              y: c.m === 0 ? c.y - 1 : c.y,
              m: c.m === 0 ? 11 : c.m - 1,
            }))
          }
          disabled={disabled}
          className="rounded-lg p-1 hover:bg-muted disabled:opacity-40"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold">
          {MONTH_NAMES[cursor.m]} {cursor.y}
        </span>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => ({
              y: c.m === 11 ? c.y + 1 : c.y,
              m: c.m === 11 ? 0 : c.m + 1,
            }))
          }
          disabled={disabled}
          className="rounded-lg p-1 hover:bg-muted disabled:opacity-40"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {DOWS.map((d) => (
          <span key={d.value} className="py-1 font-bold text-muted-foreground">
            {d.short}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const iso = toISO(d);
          const selected = value.includes(iso);
          const isToday = iso === todayIso;
          const isPast = iso < todayIso;
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(d)}
              disabled={disabled}
              className={`h-9 rounded-lg text-sm transition ${
                selected
                  ? "bg-primary font-bold text-primary-foreground"
                  : isToday
                    ? "border-2 border-primary"
                    : "hover:bg-muted"
              } ${isPast && !selected ? "text-muted-foreground/50" : ""} disabled:opacity-50`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function InstallPreference({
  contractId,
  initialSlot,
  initialNotes,
  initialDaysOfWeek,
  initialDates,
  canEdit,
}: {
  contractId: string;
  initialSlot: Slot | null;
  initialNotes: string | null;
  initialDaysOfWeek: number[] | null;
  initialDates: string[] | null;
  canEdit: boolean;
}) {
  const [slot, setSlot] = useState<Slot | null>(initialSlot);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [dows, setDows] = useState<number[]>(initialDaysOfWeek ?? []);
  const [dates, setDates] = useState<string[]>(initialDates ?? []);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleDow(v: number) {
    if (!canEdit) return;
    setDows((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort()));
  }

  function save() {
    if (!slot && dows.length === 0 && dates.length === 0 && !notes.trim()) {
      notify.warning("Indica al menos una preferencia");
      return;
    }
    if (slot === "custom" && !notes.trim()) {
      notify.warning("Indica el horario preferido en el campo de texto");
      return;
    }
    startTransition(async () => {
      const r = await saveInstallPreferenceSafeAction(contractId, {
        slot,
        notes: notes || null,
        days_of_week: dows.length > 0 ? dows : null,
        dates: dates.length > 0 ? dates : null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Preferencia guardada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Franja horaria */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Franja horaria
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SLOTS.map((o) => {
            const Icon = o.icon;
            const active = slot === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => canEdit && setSlot(active ? null : o.value)}
                disabled={!canEdit}
                className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-center text-xs font-semibold ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:border-primary/40"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <Icon className="h-5 w-5" />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Días de la semana */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Días de la semana preferidos (opcional)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DOWS.map((d) => {
            const active = dows.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                title={d.full}
                onClick={() => toggleDow(d.value)}
                disabled={!canEdit}
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fechas concretas (calendario) */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Fechas concretas (opcional · informativo)
        </p>
        <p className="text-xs text-muted-foreground">
          Pulsa los días que prefiere el cliente. Pueden ser uno o varios. Solo es
          informativo para que el técnico tenga referencia al agendar.
        </p>
        <MultiDateCalendar value={dates} onChange={setDates} disabled={!canEdit} />
        {dates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {dates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
              >
                {new Date(d).toLocaleDateString("es-ES", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setDates((c) => c.filter((x) => x !== d))}
                    className="hover:opacity-70"
                    aria-label="Quitar fecha"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Notas
        </p>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            slot === "custom"
              ? "Describe el horario que prefiere el cliente"
              : "Notas adicionales (opcional)"
          }
          disabled={!canEdit}
        />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending} size="sm">
            <Save className="h-3 w-3" /> {pending ? "Guardando…" : "Guardar preferencia"}
          </Button>
        </div>
      )}
    </div>
  );
}
