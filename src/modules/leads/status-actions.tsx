"use client";

import { useState, useTransition } from "react";
import { Phone, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadStatusSafeAction } from "./actions";
import type { LeadStatus } from "./types";

interface Props {
  leadId: string;
  currentStatus: LeadStatus;
}

/**
 * Botones inline (size="sm") para que entren en la toolbar del header.
 * Estados terminales (lost / converted) → no renderiza nada.
 */
export function LeadStatusActions({ leadId, currentStatus }: Props) {
  const [pending, startTransition] = useTransition();
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState("");

  const isTerminal = currentStatus === "lost" || currentStatus === "converted";
  const showMarkContacted = currentStatus === "new";

  function markContacted() {
    startTransition(async () => {
      const r = await updateLeadStatusSafeAction(leadId, "contacted");
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Marcado contactado");
    });
  }

  function confirmLost() {
    if (!lostReason.trim()) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      const r = await updateLeadStatusSafeAction(leadId, "lost", lostReason);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Marcado como venta perdida");
      setShowLost(false);
      setLostReason("");
    });
  }

  if (isTerminal) return null;

  return (
    <>
      {showMarkContacted && (
        <Button
          variant="outline"
          size="sm"
          onClick={markContacted}
          disabled={pending}
        >
          <Phone className="h-4 w-4" /> Contactado
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setShowLost(true)}
        disabled={pending}
      >
        <X className="h-4 w-4" /> Venta perdida
      </Button>

      <Dialog open={showLost} onOpenChange={(o) => !o && setShowLost(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar venta perdida</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Motivo de la pérdida</Label>
            <textarea
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              placeholder="Precio, competencia, no interesa..."
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowLost(false);
                setLostReason("");
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmLost} disabled={pending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
