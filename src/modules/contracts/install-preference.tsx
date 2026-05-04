"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon, CalendarClock, Save, Calendar } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { saveInstallPreferenceAction } from "./actions";

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

export function InstallPreference({
  contractId,
  initialSlot,
  initialNotes,
  initialDaysOfWeek,
  initialDayOfMonth,
  canEdit,
}: {
  contractId: string;
  initialSlot: Slot | null;
  initialNotes: string | null;
  initialDaysOfWeek: number[] | null;
  initialDayOfMonth: number | null;
  canEdit: boolean;
}) {
  const [slot, setSlot] = useState<Slot | null>(initialSlot);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [dows, setDows] = useState<number[]>(initialDaysOfWeek ?? []);
  const [dom, setDom] = useState<string>(initialDayOfMonth ? String(initialDayOfMonth) : "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleDow(v: number) {
    if (!canEdit) return;
    setDows((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort()));
  }

  function save() {
    if (!slot && dows.length === 0 && !dom) {
      notify.warning("Indica al menos una preferencia (franja, día semana o día del mes)");
      return;
    }
    if (slot === "custom" && !notes.trim()) {
      notify.warning("Indica el horario preferido en el campo de texto");
      return;
    }
    let domNum: number | null = null;
    if (dom) {
      const n = parseInt(dom, 10);
      if (isNaN(n) || n < 1 || n > 31) {
        notify.warning("El día del mes debe estar entre 1 y 31");
        return;
      }
      domNum = n;
    }
    startTransition(async () => {
      try {
        await saveInstallPreferenceAction(contractId, {
          slot,
          notes: notes || null,
          days_of_week: dows.length > 0 ? dows : null,
          day_of_month: domNum,
        });
        notify.success("Preferencia guardada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
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

      {/* Día del mes */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Día concreto del mes (opcional)
        </p>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Input
            type="number"
            min={1}
            max={31}
            value={dom}
            onChange={(e) => setDom(e.target.value)}
            disabled={!canEdit}
            placeholder="Ej. 15"
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">de cada mes</span>
        </div>
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
