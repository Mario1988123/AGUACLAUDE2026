"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markProposalAccepted, markProposalRejected, markProposalSent } from "./actions";
import { createContractFromProposal } from "@/modules/contracts/actions";
import type { ProposalStatus } from "./schemas";

interface Props {
  proposalId: string;
  status: ProposalStatus;
}

export function ProposalActions({ proposalId, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function send() {
    startTransition(async () => {
      try {
        await markProposalSent(proposalId);
        notify.success("Marcada como enviada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function accept() {
    startTransition(async () => {
      try {
        await markProposalAccepted(proposalId);
        notify.success("Aceptada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  function reject() {
    startTransition(async () => {
      try {
        await markProposalRejected(proposalId, reason);
        notify.success("Rechazada");
        setRejecting(false);
        setReason("");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function generateContract() {
    startTransition(async () => {
      try {
        await createContractFromProposal(proposalId);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (status === "accepted") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-success">Aceptada por el cliente.</p>
        <Button onClick={generateContract} disabled={pending} className="w-full">
          Generar contrato
        </Button>
      </div>
    );
  }
  if (status === "rejected" || status === "superseded" || status === "expired") {
    return <p className="text-sm text-muted-foreground">Sin acciones disponibles.</p>;
  }

  return (
    <div className="space-y-2">
      {(status === "draft" || status === "active") && (
        <Button onClick={send} disabled={pending} className="w-full" variant="warning">
          Marcar como enviada
        </Button>
      )}
      <Button onClick={accept} disabled={pending} className="w-full" variant="success">
        Marcar aceptada
      </Button>
      {!rejecting ? (
        <Button
          onClick={() => setRejecting(true)}
          disabled={pending}
          variant="outline"
          className="w-full"
        >
          Rechazar
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-destructive bg-destructive/5 p-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Motivo (opcional)"
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={reject} disabled={pending}>
              Confirmar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
