"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { updateErrorReportAction } from "./actions";

type Status =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "closed"
  | "wont_fix";

interface Props {
  id: string;
  currentStatus: Status;
  currentNotes: string | null;
}

const NEXT_STATUSES: Record<Status, Status[]> = {
  new: ["triaged", "in_progress", "wont_fix"],
  triaged: ["in_progress", "resolved", "wont_fix"],
  in_progress: ["resolved", "wont_fix"],
  resolved: ["closed"],
  closed: [],
  wont_fix: [],
};

const STATUS_LABEL: Record<Status, string> = {
  new: "Nuevo",
  triaged: "Revisado",
  in_progress: "En curso",
  resolved: "Resuelto",
  closed: "Cerrado",
  wont_fix: "No se arreglará",
};

export function ErrorReportRowActions({ id, currentStatus, currentNotes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(currentNotes ?? "");
  const nextOptions = NEXT_STATUSES[currentStatus] ?? [];

  function changeStatus(status: Status) {
    startTransition(async () => {
      const r = await updateErrorReportAction({ id, status });
      if (!r.ok) {
        notify.error("No se pudo actualizar", r.error);
        return;
      }
      notify.success(`Marcado como ${STATUS_LABEL[status]}`);
      router.refresh();
    });
  }

  function saveNotes() {
    startTransition(async () => {
      const r = await updateErrorReportAction({ id, internal_notes: notes });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Notas guardadas");
      setEditingNotes(false);
      router.refresh();
    });
  }

  if (editingNotes) {
    return (
      <div className="space-y-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notas internas (no visibles al cliente)"
          className="w-full rounded-md border border-input bg-background p-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingNotes(false);
              setNotes(currentNotes ?? "");
            }}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={saveNotes} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {nextOptions.map((s) => (
        <Button
          key={s}
          size="sm"
          variant={s === "resolved" || s === "closed" ? "success" : "outline"}
          onClick={() => changeStatus(s)}
          disabled={pending}
        >
          → {STATUS_LABEL[s]}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditingNotes(true)}
        disabled={pending}
      >
        {currentNotes ? "Editar notas" : "+ Notas internas"}
      </Button>
    </div>
  );
}
