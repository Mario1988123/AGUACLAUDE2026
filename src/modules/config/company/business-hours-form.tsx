"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { updateBusinessHoursAction } from "./actions";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

export type BusinessHours = Record<string, { open: string; close: string } | null>;

/**
 * Editor del HORARIO GENERAL de la empresa (cuando está abierta al público).
 * Distinto del horario por usuario (ScheduleEditor) que define la jornada
 * laboral de cada trabajador. Antes vivía en /configuracion (página raíz);
 * desde 2026-05-11 se ha integrado en /configuracion/horarios.
 */
export function BusinessHoursForm({ initial }: { initial: BusinessHours }) {
  const [hours, setHours] = useState<BusinessHours>(initial);
  const [pending, startTransition] = useTransition();

  function toggleDay(key: string) {
    setHours((h) => ({
      ...h,
      [key]: h[key] ? null : { open: "09:00", close: "18:00" },
    }));
  }
  function setHour(key: string, kind: "open" | "close", value: string) {
    setHours((h) => ({
      ...h,
      [key]: h[key]
        ? { ...h[key]!, [kind]: value }
        : { open: "09:00", close: "18:00", [kind]: value },
    }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateBusinessHoursAction(hours);
        notify.success("Horario guardado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Horario en el que la empresa está abierta al público. No es la jornada
        laboral por usuario (esa se define abajo en &laquo;Horario semanal por usuario&raquo;).
      </p>
      {DAYS.map((d) => {
        const active = hours[d.key] != null;
        return (
          <div
            key={d.key}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <label className="flex w-32 items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={active}
                onChange={() => toggleDay(d.key)}
                className="h-5 w-5"
              />
              {d.label}
            </label>
            {active ? (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  type="time"
                  value={hours[d.key]!.open}
                  onChange={(e) => setHour(d.key, "open", e.target.value)}
                  className="max-w-[120px]"
                />
                <span>—</span>
                <Input
                  type="time"
                  value={hours[d.key]!.close}
                  onChange={(e) => setHour(d.key, "close", e.target.value)}
                  className="max-w-[120px]"
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Cerrado</span>
            )}
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar horario"}
        </Button>
      </div>
    </div>
  );
}
