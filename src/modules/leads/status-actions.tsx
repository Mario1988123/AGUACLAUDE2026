"use client";

import { useState, useTransition } from "react";
import { Phone, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadStatus } from "./actions";
import { STATUS_LABEL } from "./schemas";
import type { LeadStatus } from "./types";

interface Props {
  leadId: string;
  currentStatus: LeadStatus;
}

/**
 * El estado de leads se gestiona automáticamente:
 *  - Llamar/WhatsApp/Email → contacted
 *  - Crear propuesta → proposal_created
 *  - Enviar propuesta → proposal_sent
 *  - Aceptar propuesta o pulsar "Convertir" → converted (+ crea cliente)
 *
 * Aquí sólo dejamos lo que NO es automático:
 *  - "Marcar contactado" manual (si entra ya contactado por canal externo)
 *  - "Marcar como perdido" (terminal)
 */
export function LeadStatusActions({ leadId, currentStatus }: Props) {
  const [pending, startTransition] = useTransition();
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState("");

  const isTerminal = currentStatus === "lost" || currentStatus === "converted";
  const showMarkContacted = currentStatus === "new";

  function markContacted() {
    startTransition(async () => {
      try {
        await updateLeadStatus(leadId, "contacted");
        notify.success("Marcado contactado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function confirmLost() {
    if (!lostReason.trim()) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      try {
        await updateLeadStatus(leadId, "lost", lostReason);
        notify.success("Marcado como venta perdida");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (isTerminal) {
    return (
      <p className="text-sm text-muted-foreground">
        Estado: <strong>{STATUS_LABEL[currentStatus]}</strong>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm">
        Estado actual: <strong>{STATUS_LABEL[currentStatus]}</strong>
      </div>
      <p className="text-xs text-muted-foreground">
        El estado avanza solo: al llamar/whatsapp/email pasa a contactado, al crear o
        enviar propuesta avanza, y al aceptar propuesta o pulsar &quot;Convertir&quot; pasa a
        cliente.
      </p>

      {showMarkContacted && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={markContacted}
          disabled={pending}
        >
          <Phone className="h-4 w-4" /> Marcar contactado
        </Button>
      )}

      {!showLost ? (
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => setShowLost(true)}
          disabled={pending}
        >
          <X className="h-4 w-4" /> Marcar venta perdida
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-destructive bg-destructive/5 p-3">
          <Label className="text-sm font-medium">Motivo de la pérdida</Label>
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
