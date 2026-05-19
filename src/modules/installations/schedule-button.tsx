"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, MapPin, Star, AlertCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateInstallationSafeAction } from "./actions";
import {
  getSchedulingContext,
  type SchedulingContext,
} from "./scheduling-context";

const DAY_LABEL_FULL = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const DAY_LABEL_SHORT_LMX = ["L", "M", "X", "J", "V", "S", "D"];

const SLOT_LABEL: Record<string, string> = {
  morning: "Mañana (9-13h)",
  afternoon: "Tarde (16-20h)",
  any: "Cualquier franja",
  custom: "Horario personalizado",
};

/**
 * Botón "Agendar instalación" — abre modal con:
 *  · Preferencias del cliente (slot, días, fechas, notas) visibles arriba.
 *  · Mini-calendario semanal con huecos del instalador (rojo=ocupado).
 *  · Sugerencia automática de la fecha preferida más próxima.
 *  · Result pattern: errores se muestran en toast en lugar de 500 genérico.
 */
export function ScheduleInstallationButton({
  installationId,
  currentScheduledAt,
  currentInstallerId,
  installers,
}: {
  installationId: string;
  currentScheduledAt: string | null;
  currentInstallerId: string | null;
  installers: { user_id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [ctx, setCtx] = useState<SchedulingContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  const defaultDate = (() => {
    if (currentScheduledAt) return currentScheduledAt.slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  const defaultTime = (() => {
    if (currentScheduledAt) {
      const d = new Date(currentScheduledAt);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return "10:00";
  })();

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [installerId, setInstallerId] = useState(currentInstallerId ?? "");

  // Cargar contexto al abrir o cambiar instalador
  useEffect(() => {
    if (!open) return;
    setLoadingCtx(true);
    getSchedulingContext(installationId, installerId || null)
      .then((r) => setCtx(r))
      .finally(() => setLoadingCtx(false));
  }, [open, installationId, installerId]);

  // Sugerir primera fecha preferida si existe y aún no se ha cambiado.
  useEffect(() => {
    if (!ctx?.preferences.dates || ctx.preferences.dates.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextPref = ctx.preferences.dates
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()) && d >= today)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (nextPref && !currentScheduledAt) {
      setDate(
        `${nextPref.getFullYear()}-${String(nextPref.getMonth() + 1).padStart(2, "0")}-${String(nextPref.getDate()).padStart(2, "0")}`,
      );
    }
  }, [ctx, currentScheduledAt]);

  function save() {
    if (!date) {
      notify.warning("Indica la fecha");
      return;
    }
    if (!installerId) {
      notify.warning("Selecciona un instalador");
      return;
    }
    const isoLocal = `${date}T${time}:00`;
    const iso = new Date(isoLocal).toISOString();

    startTransition(async () => {
      const r = await updateInstallationSafeAction({
        id: installationId,
        scheduled_at: iso,
        installer_user_id: installerId,
      });
      if (!r.ok) {
        notify.error("No se pudo agendar", r.error);
        return;
      }
      notify.success(
        currentScheduledAt ? "Instalación reagendada" : "Instalación agendada",
      );
      setOpen(false);
      router.refresh();
    });
  }

  const isReschedule = !!currentScheduledAt;
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant={isReschedule ? "outline" : "success"}
        className="gap-2"
      >
        <Calendar className="h-4 w-4" />
        {isReschedule ? "Reagendar" : "Agendar instalación"}
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <h2 className="text-lg font-bold">
                {isReschedule ? "Reagendar instalación" : "Agendar instalación"}
              </h2>

              {ctx && (
                <PreferencesPanel
                  ctx={ctx}
                  loading={loadingCtx}
                  onPickDate={setDate}
                />
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Hora</Label>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Instalador asignado</Label>
                <select
                  value={installerId}
                  onChange={(e) => setInstallerId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Selecciona un instalador —</option>
                  {installers.map((i) => (
                    <option key={i.user_id} value={i.user_id}>
                      {i.full_name}
                    </option>
                  ))}
                </select>
                {installers.length === 0 && (
                  <p className="text-xs text-amber-700">
                    ⚠ No hay instaladores con rol installer/technical_director.
                    Asigna roles en /configuracion/usuarios para que aparezcan
                    aquí.
                  </p>
                )}
              </div>

              {ctx && installerId && (
                <AvailabilityCalendar
                  ctx={ctx}
                  selectedDate={date}
                  onPick={setDate}
                />
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending} variant="success">
                {pending ? "Guardando…" : isReschedule ? "Reagendar" : "Agendar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PreferencesPanel({
  ctx,
  loading,
  onPickDate,
}: {
  ctx: SchedulingContext;
  loading: boolean;
  onPickDate: (d: string) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
        Cargando preferencias del cliente…
      </div>
    );
  }
  const p = ctx.preferences;
  const hasAny =
    p.slot ||
    p.notes ||
    (p.days_of_week && p.days_of_week.length > 0) ||
    (p.dates && p.dates.length > 0) ||
    ctx.customer_address;
  if (!hasAny) {
    return (
      <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
        Sin preferencias horarias indicadas por el cliente.
      </div>
    );
  }
  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-3 space-y-2 text-sm">
      <div className="font-bold text-blue-900">Preferencias del cliente</div>
      {ctx.customer_address && (
        <div className="flex items-start gap-2 text-xs">
          <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <span>{ctx.customer_address}</span>
        </div>
      )}
      {p.slot && (
        <div className="text-xs">
          <span className="text-muted-foreground">Franja:</span>{" "}
          <strong>{SLOT_LABEL[p.slot] ?? p.slot}</strong>
        </div>
      )}
      {p.days_of_week && p.days_of_week.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Días que le van bien:</span>{" "}
          <strong>
            {p.days_of_week.map((d) => DAY_LABEL_FULL[d]).join(", ")}
          </strong>
        </div>
      )}
      {p.dates && p.dates.length > 0 && (
        <div className="text-xs space-y-1">
          <div className="text-muted-foreground">Fechas concretas:</div>
          <div className="flex flex-wrap gap-1">
            {p.dates.map((d) => {
              const dt = new Date(d);
              const past = dt < new Date();
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => !past && onPickDate(d.slice(0, 10))}
                  disabled={past}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                    past
                      ? "border-border bg-muted text-muted-foreground line-through"
                      : "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                  title={past ? "Fecha ya pasada" : "Usar esta fecha"}
                >
                  <Star className="inline h-3 w-3 mr-0.5" />
                  {dt.toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "short",
                  })}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {p.notes && (
        <div className="text-xs">
          <span className="text-muted-foreground">Notas:</span> {p.notes}
        </div>
      )}
    </div>
  );
}

function AvailabilityCalendar({
  ctx,
  selectedDate,
  onPick,
}: {
  ctx: SchedulingContext;
  selectedDate: string;
  onPick: (d: string) => void;
}) {
  // 4 semanas desde el lunes de la fecha seleccionada
  const ref = selectedDate ? new Date(selectedDate) : new Date();
  const dow = ref.getDay(); // 0=domingo
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((dow + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const weeks: Date[][] = [];
  for (let w = 0; w < 4; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }

  function keyOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const prefDates = new Set(
    (ctx.preferences.dates ?? []).map((d) => d.slice(0, 10)),
  );

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold">Disponibilidad del instalador</div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-red-200 border border-red-300" />
            Ocupado
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-amber-100 border border-amber-300" />
            Media jornada
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-card border" />
            Libre
          </span>
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-500" />
            Pref.
          </span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
        {DAY_LABEL_SHORT_LMX.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((w, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {w.map((d) => {
              const k = keyOf(d);
              const busy = ctx.installer_busy_days[k] ?? 0;
              const slots = ctx.installer_free_slots[k];
              const past = d < today;
              const isPref = prefDates.has(k);
              const isSelected = k === selectedDate;
              const fullyBusy = slots && !slots.morning && !slots.afternoon;
              const partialBusy = slots && slots.morning !== slots.afternoon;
              let bg = "bg-card border";
              if (fullyBusy) bg = "bg-red-200 border-red-300";
              else if (partialBusy) bg = "bg-amber-100 border-amber-300";
              if (isPref && !past)
                bg = "bg-amber-100 border-amber-400 ring-1 ring-amber-300";
              if (past)
                bg = "bg-muted text-muted-foreground opacity-50 border";
              if (isSelected) bg += " ring-2 ring-primary";
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => !past && onPick(k)}
                  disabled={past}
                  className={`relative h-10 rounded-md text-xs font-bold transition ${bg} hover:opacity-80 disabled:cursor-not-allowed`}
                  title={
                    fullyBusy
                      ? `Día completo (${busy} instalación${busy > 1 ? "es" : ""})`
                      : partialBusy
                        ? `Solo libre ${slots?.morning ? "mañana" : "tarde"}`
                        : "Libre"
                  }
                >
                  {d.getDate()}
                  {isPref && (
                    <Star className="absolute right-0.5 top-0.5 h-2.5 w-2.5 fill-amber-500 text-amber-600" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {Object.keys(ctx.installer_busy_days).length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Sin instalaciones programadas para este instalador en las próximas 4
          semanas. Todos los días están libres.
        </p>
      )}
      <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
        Datos en tiempo real. No tiene en cuenta vacaciones — coordina con el
        instalador en caso de duda.
      </p>
    </div>
  );
}
