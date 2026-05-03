"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { rescheduleAgendaEventAction } from "./actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  currentStartsAt: string;
  eventTitle?: string;
}

export function MoveEventDialog({
  open,
  onOpenChange,
  eventId,
  currentStartsAt,
  eventTitle,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtTime(iso: string) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  const [date, setDate] = useState(fmtDate(currentStartsAt));
  const [time, setTime] = useState(fmtTime(currentStartsAt));

  useEffect(() => {
    if (open) {
      setDate(fmtDate(currentStartsAt));
      setTime(fmtTime(currentStartsAt));
    }
  }, [open, currentStartsAt]);

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
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover evento{eventTitle ? `: ${eventTitle}` : ""}</DialogTitle>
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
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending} variant="success">
              {pending ? "Guardando..." : "Reagendar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
