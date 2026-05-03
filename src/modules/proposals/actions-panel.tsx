"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  markProposalAccepted,
  markProposalRejected,
  markProposalSent,
  approveProposalAction,
  rejectApprovalAction,
  convertAcceptedProposalToCustomerAction,
} from "./actions";
import { createContractFromProposal } from "@/modules/contracts/actions";
import type { ProposalStatus } from "./schemas";

interface Props {
  proposalId: string;
  status: ProposalStatus;
  /** true si el usuario actual es nivel 1/2 (ve botón Validar) */
  canApprove: boolean;
  /** true si la propuesta es para un lead (sin cliente todavía) */
  hasLead: boolean;
}

export function ProposalActions({ proposalId, status, canApprove, hasLead }: Props) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [rejectingApproval, setRejectingApproval] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();

  function send() {
    startTransition(async () => {
      try {
        await markProposalSent(proposalId);
        notify.success("Marcada como enviada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function accept() {
    startTransition(async () => {
      try {
        await markProposalAccepted(proposalId);
        notify.success("Propuesta aceptada por el cliente");
        router.refresh();
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
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function approve() {
    startTransition(async () => {
      try {
        await approveProposalAction(proposalId);
        notify.success("Propuesta validada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function rejectApproval() {
    startTransition(async () => {
      try {
        await rejectApprovalAction(proposalId, reason);
        notify.success("Aprobación rechazada — vuelve a borrador");
        setRejectingApproval(false);
        setReason("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function passToContract() {
    startTransition(async () => {
      try {
        if (hasLead) {
          // Si era para un lead: 1) convertir a cliente, 2) generar contrato.
          const r = await convertAcceptedProposalToCustomerAction(proposalId);
          notify.success(`Cliente creado, generando contrato…`);
          await createContractFromProposal(proposalId);
          router.push(`/clientes/${r.customer_id}` as never);
        } else {
          await createContractFromProposal(proposalId);
        }
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  // === Estado: Pendiente aprobación ===
  if (status === "pending_approval") {
    if (!canApprove) {
      return (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-center text-sm">
          <p className="font-bold text-amber-900">⏳ Pendiente de validación</p>
          <p className="mt-1 text-xs text-amber-800">
            Algún precio está por debajo del mínimo. Esperando validación de admin o director.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-center text-sm">
          <p className="font-bold text-amber-900">⏳ Requiere tu validación</p>
          <p className="mt-1 text-xs text-amber-800">
            Algún precio está por debajo del mínimo autorizado.
          </p>
        </div>
        <Button onClick={approve} disabled={pending} className="w-full" variant="success">
          ✓ Validar propuesta
        </Button>
        {!rejectingApproval ? (
          <Button
            onClick={() => setRejectingApproval(true)}
            disabled={pending}
            variant="outline"
            className="w-full"
          >
            Rechazar aprobación
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Motivo (opcional)"
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectingApproval(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={rejectApproval}
                disabled={pending}
              >
                Confirmar
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // === Estado: Aceptada ===
  if (status === "accepted") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-bold text-emerald-700">✓ Aceptada por el cliente</p>
        <Button onClick={passToContract} disabled={pending} className="w-full" variant="success">
          → Pasar a contrato
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Esto generará el contrato. Puedes esperar unos días si el cliente no firma todavía.
        </p>
      </div>
    );
  }

  if (status === "rejected" || status === "superseded" || status === "expired") {
    return <p className="text-sm text-muted-foreground">Sin acciones disponibles.</p>;
  }

  // === Borrador / Activa / Enviada ===
  return (
    <div className="space-y-2">
      {(status === "draft" || status === "active") && (
        <Button onClick={send} disabled={pending} className="w-full" variant="warning">
          ✉ Marcar como enviada
        </Button>
      )}
      {status === "sent" && (
        <p className="text-xs text-center text-muted-foreground">
          Esperando respuesta del cliente
        </p>
      )}
      <Button onClick={accept} disabled={pending} className="w-full" variant="success">
        ✓ Cliente la aceptó
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
