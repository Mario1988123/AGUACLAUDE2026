"use client";

import { useState, useTransition } from "react";
import { UserPlus, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { assignIncidentSafeAction, resolveIncidentSafeAction } from "./actions";

export function IncidentActionsPanel({
  incidentId,
  status,
  assignedUserId,
  team,
}: {
  incidentId: string;
  status: string;
  assignedUserId: string | null;
  team: { user_id: string; full_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [assignTo, setAssignTo] = useState(assignedUserId ?? "");
  const [notes, setNotes] = useState("");
  const isResolved = status === "resolved" || status === "closed";

  function doAssign() {
    startTransition(async () => {
      const r = await assignIncidentSafeAction(incidentId, assignTo);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(assignTo ? "Asignada" : "Desasignada");
      location.reload();
    });
  }

  function doResolve() {
    if (!notes.trim()) {
      notify.warning("Añade notas de resolución");
      return;
    }
    startTransition(async () => {
      const r = await resolveIncidentSafeAction(incidentId, notes);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Resuelta");
      location.reload();
    });
  }

  if (isResolved) {
    return <p className="text-sm text-success">✓ Incidencia resuelta</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-sm font-bold uppercase tracking-wide">Asignar a</Label>
        <select
          value={assignTo}
          onChange={(e) => setAssignTo(e.target.value)}
          className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">— Sin asignar —</option>
          {team.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={doAssign} disabled={pending} className="w-full">
          <UserPlus className="h-4 w-4" /> Guardar asignación
        </Button>
      </div>

      <div className="space-y-1.5 border-t pt-4">
        <Label>Notas de resolución *</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          placeholder="¿Cómo se resolvió la incidencia?"
        />
        <Button onClick={doResolve} disabled={pending} className="w-full" size="lg">
          <CheckCircle2 className="h-5 w-5" />
          Marcar como resuelta
        </Button>
      </div>
    </div>
  );
}
