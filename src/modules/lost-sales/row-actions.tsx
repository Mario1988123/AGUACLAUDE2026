"use client";

import { useState, useTransition } from "react";
import { Undo2, UserPlus, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  assignRecoveryAction,
  markRecoveredAction,
  reopenLostSaleAction,
} from "./actions";

export function LostSaleRowActions({
  lostSaleId,
  hasLead,
  isRecovered,
  assignedUserId,
  team,
}: {
  lostSaleId: string;
  hasLead: boolean;
  isRecovered: boolean;
  assignedUserId: string | null;
  team: { user_id: string; full_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [assignTo, setAssignTo] = useState(assignedUserId ?? "");

  if (isRecovered) {
    return <span className="text-xs text-success">✓ Recuperada</span>;
  }

  function assign() {
    startTransition(async () => {
      try {
        await assignRecoveryAction(lostSaleId, assignTo);
        notify.success(assignTo ? "Asignada para recuperación" : "Desasignada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reopen() {
    if (!confirm("¿Reabrir el lead asociado y mover esta venta a recuperada?")) return;
    startTransition(async () => {
      try {
        await reopenLostSaleAction(lostSaleId);
        notify.success("Lead reabierto");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function done() {
    startTransition(async () => {
      try {
        await markRecoveredAction(lostSaleId);
        notify.success("Marcada recuperada");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <select
        value={assignTo}
        onChange={(e) => setAssignTo(e.target.value)}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">— Sin asignar —</option>
        {team.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.full_name}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={assign} disabled={pending}>
        <UserPlus className="h-3 w-3" />
      </Button>
      {hasLead && (
        <Button size="sm" variant="outline" onClick={reopen} disabled={pending}>
          <Undo2 className="h-3 w-3" /> Reabrir
        </Button>
      )}
      <Button size="sm" variant="success" onClick={done} disabled={pending}>
        <CheckCircle2 className="h-3 w-3" /> Recuperada
      </Button>
    </div>
  );
}
