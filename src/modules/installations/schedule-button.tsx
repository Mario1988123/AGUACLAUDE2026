"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateInstallationAction } from "./actions";

/**
 * Botón "Agendar instalación" — abre modal con fecha/hora + instalador.
 * Si la instalación ya está agendada, el botón dice "Reagendar" y los
 * inputs vienen pre-rellenos.
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

  // Default: si ya hay scheduled_at, usar; si no, hoy + 7 días a las 10:00
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

  function save() {
    if (!date) {
      notify.warning("Indica la fecha");
      return;
    }
    const isoLocal = `${date}T${time}:00`;
    const iso = new Date(isoLocal).toISOString();

    startTransition(async () => {
      try {
        await updateInstallationAction({
          id: installationId,
          scheduled_at: iso,
          installer_user_id: installerId || null,
        });
        notify.success(
          currentScheduledAt ? "Instalación reagendada" : "Instalación agendada",
        );
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
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
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <h2 className="text-lg font-bold">
                {isReschedule ? "Reagendar instalación" : "Agendar instalación"}
              </h2>
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
                  <option value="">— Sin asignar —</option>
                  {installers.map((i) => (
                    <option key={i.user_id} value={i.user_id}>
                      {i.full_name}
                    </option>
                  ))}
                </select>
                {installers.length === 0 && (
                  <p className="text-xs text-amber-700">
                    ⚠ No hay instaladores con rol installer/technical_director. Asigna roles en
                    /configuracion/usuarios para que aparezcan aquí.
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
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
