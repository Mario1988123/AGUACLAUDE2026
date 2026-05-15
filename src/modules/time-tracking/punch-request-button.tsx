"use client";

import { useState, useTransition } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createPunchRequestAction } from "./punch-requests-actions";

const KIND_OPTIONS = [
  { value: "clock_in", label: "Entrada" },
  { value: "clock_out", label: "Salida" },
  { value: "break_start", label: "Inicio descanso" },
  { value: "break_end", label: "Fin descanso" },
] as const;

export function PunchRequestButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]["value"]>("clock_in");
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState(
    `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`,
  );
  const [reason, setReason] = useState("");

  function submit() {
    if (!date || !time) {
      notify.warning("Fecha y hora obligatorias");
      return;
    }
    if (reason.trim().length < 3) {
      notify.warning("Indica el motivo de la solicitud");
      return;
    }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    startTransition(async () => {
      try {
        await createPunchRequestAction({
          requested_at: iso,
          punch_kind: kind,
          reason: reason.trim(),
        });
        notify.success("Solicitud enviada", "El admin la revisará");
        setOpen(false);
        setReason("");
      } catch (err) {
        notify.error(
          "Error",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Clock className="h-4 w-4" /> Solicitar fichaje
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 p-5">
              <h2 className="text-lg font-bold">Solicitar fichaje manual</h2>
              <p className="text-xs text-muted-foreground">
                Si olvidaste fichar o hubo un fallo, pide a admin que registre el
                fichaje con la hora real.
              </p>
              <div className="space-y-1.5">
                <Label>Tipo de fichaje</Label>
                <select
                  value={kind}
                  onChange={(e) =>
                    setKind(
                      e.target.value as (typeof KIND_OPTIONS)[number]["value"],
                    )
                  }
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={date}
                    max={todayStr}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Hora</Label>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Motivo *</Label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. olvidé fichar la salida del viernes a las 17:30"
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                {pending ? "Enviando..." : "Enviar solicitud"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
