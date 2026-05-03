"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { MoveEventDialog } from "./move-event-dialog";

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
      <MoveEventDialog
        open={open}
        onOpenChange={setOpen}
        eventId={eventId}
        currentStartsAt={currentStartsAt}
      />
    </>
  );
}
