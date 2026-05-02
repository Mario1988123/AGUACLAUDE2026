"use client";

import { useState, useTransition } from "react";
import { Play, X, Undo2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  installFreeTrialAction,
  rejectFreeTrialAction,
  markReturnedAction,
} from "./actions";

export function FreeTrialActionsPanel({
  trialId,
  status,
}: {
  trialId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function install() {
    startTransition(async () => {
      try {
        await installFreeTrialAction(trialId);
        notify.success("Prueba instalada");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function reject() {
    if (!reason.trim()) {
      notify.warning("Indica motivo de rechazo");
      return;
    }
    startTransition(async () => {
      try {
        await rejectFreeTrialAction(trialId, reason);
        notify.success("Marcada como rechazada");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function returned() {
    startTransition(async () => {
      try {
        await markReturnedAction(trialId);
        notify.success("Equipo devuelto al almacén");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (status === "draft" || status === "scheduled") {
    return (
      <Button onClick={install} disabled={pending} size="lg" className="w-full">
        <Play className="h-5 w-5" />
        {pending ? "Instalando..." : "Marcar instalada"}
      </Button>
    );
  }
  if (status === "installed") {
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Prueba activa. Si el cliente acepta, genera contrato desde su ficha.
        </p>
        <div className="space-y-1.5">
          <Label>Motivo rechazo</Label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            placeholder="¿Por qué no quiere?"
          />
          <Button
            variant="outline"
            onClick={reject}
            disabled={pending}
            className="w-full"
          >
            <X className="h-4 w-4" /> Marcar rechazada
          </Button>
        </div>
      </div>
    );
  }
  if (status === "rejected" || status === "expired") {
    return (
      <Button
        onClick={returned}
        disabled={pending}
        variant="outline"
        size="lg"
        className="w-full"
      >
        <Undo2 className="h-5 w-5" />
        {pending ? "Procesando..." : "Marcar devuelta (re-stock)"}
      </Button>
    );
  }
  return <p className="text-sm text-muted-foreground">Sin acciones disponibles.</p>;
}
