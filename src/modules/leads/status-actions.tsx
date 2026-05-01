"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadStatus } from "./actions";
import { LEAD_STATUS, STATUS_LABEL } from "./schemas";
import type { LeadStatus } from "./types";

interface Props {
  leadId: string;
  currentStatus: LeadStatus;
}

export function LeadStatusActions({ leadId, currentStatus }: Props) {
  const [pending, startTransition] = useTransition();
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState("");

  function handleChange(next: LeadStatus) {
    if (next === "lost") {
      setShowLost(true);
      return;
    }
    startTransition(async () => {
      try {
        await updateLeadStatus(leadId, next);
        notify.success(`Estado: ${STATUS_LABEL[next]}`);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function confirmLost() {
    startTransition(async () => {
      try {
        await updateLeadStatus(leadId, "lost", lostReason);
        notify.success("Marcado como venta perdida");
        setShowLost(false);
        setLostReason("");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="text-sm">
        Estado actual: <strong>{STATUS_LABEL[currentStatus]}</strong>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {LEAD_STATUS.filter((s) => s !== currentStatus && s !== "expired").map((s) => (
          <Button
            key={s}
            variant={s === "lost" ? "destructive" : s === "converted" ? "success" : "outline"}
            size="sm"
            onClick={() => handleChange(s)}
            disabled={pending}
          >
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      {showLost && (
        <div className="space-y-2 rounded-md border border-destructive bg-destructive/5 p-3">
          <label className="text-sm font-medium">Motivo de la pérdida</label>
          <textarea
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
            placeholder="Precio, competencia, no interesa..."
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowLost(false);
                setLostReason("");
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmLost} disabled={pending}>
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
