"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { rescheduleAgendaEventAction } from "./actions";

/**
 * Botón "Mover" alternativo al drag-and-drop. Funciona en tablet/móvil donde
 * el HTML5 drag nativo no responde a eventos touch. Abre date+time picker.
 */
export function MoveAgendaEventButton({
  eventId,
  currentStartsAt,
}: {
  eventId: string;
  currentStartsAt: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const cur = new Date(currentStartsAt);
  const curDate = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
  const curTime = `${String(cur.getHours()).padStart(2, "0")}:${String(cur.getMinutes()).padStart(2, "0")}`;
  const [date, setDate] = useState(curDate);
  const [time, setTime] = useState(curTime);

  function save() {
    if (!date || !time) {
      notify.warning("Indica fecha y hora");
      return;
    }
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const newDate = new Date(y!, (m ?? 1) - 1, d!, hh ?? 0, mm ?? 0, 0);
    const iso = newDate.toISOString();
    startTransition(async () => {
      try {
        await rescheduleAgendaEventAction(eventId, iso);
        notify.success("Evento reagendado");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
        aria-label="Mover a otro día"
        title="Mover a otro día"
      >
        <CalendarClock className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover evento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nueva fecha</Label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nueva hora</Label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              La duración del evento (si tenía hora de fin) se conserva.
            </p>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending} variant="success">
                {pending ? "Guardando..." : "Reagendar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
