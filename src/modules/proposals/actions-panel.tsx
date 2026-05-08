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
  /** id del contrato ya generado a partir de esta propuesta (si existe) */
  contractId?: string | null;
}

export function ProposalActions({
  proposalId,
  status,
  canApprove,
  hasLead,
  contractId,
}: Props) {
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
        const res = await markProposalAccepted(proposalId);
        notify.success("Propuesta aceptada");
        // Flujo continuo: redirigimos al cliente con banner ?from_proposal=
        // para completar datos y generar contrato en el mismo paso.
        if (res.customer_id) {
          router.push(`/clientes/${res.customer_id}?from_proposal=${proposalId}` as never);
          return;
        }
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
          // Si era para un lead, primero convertimos a cliente y enviamos
          // al usuario a la ficha del cliente para que complete los datos
          // pendientes (DNI, IBAN, dirección) ANTES de generar el contrato.
          const r = await convertAcceptedProposalToCustomerAction(proposalId);
          notify.success("Cliente creado. Completa sus datos y luego genera el contrato.");
          router.push(
            `/clientes/${r.customer_id}?from_proposal=${proposalId}` as never,
          );
        } else {
          // Cliente ya existe: generar el contrato directamente
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
      return null;
    }
    return (
      <>
        <Button onClick={approve} disabled={pending} variant="success" size="sm">
          ✓ Validar
        </Button>
        <Button
          onClick={() => setRejectingApproval(true)}
          disabled={pending}
          variant="outline"
          size="sm"
        >
          Rechazar
        </Button>
        {rejectingApproval && (
          <ReasonModal
            title="Rechazar aprobación"
            value={reason}
            onChange={setReason}
            onCancel={() => setRejectingApproval(false)}
            onConfirm={rejectApproval}
            pending={pending}
          />
        )}
      </>
    );
  }

  // === Estado: Aceptada ===
  if (status === "accepted") {
    if (contractId) {
      return (
        <Button asChild variant="success" size="sm">
          <a href={`/contratos/${contractId}`}>→ Ver contrato</a>
        </Button>
      );
    }
    return (
      <Button onClick={passToContract} disabled={pending} variant="success" size="sm">
        → Pasar a contrato
      </Button>
    );
  }

  if (status === "rejected" || status === "superseded" || status === "expired") {
    return null;
  }

  // === Borrador / Activa / Enviada ===
  return (
    <>
      {(status === "draft" || status === "active") && (
        <Button onClick={send} disabled={pending} variant="warning" size="sm">
          ✉ Marcar enviada
        </Button>
      )}
      <Button onClick={accept} disabled={pending} variant="success" size="sm">
        ✓ Aceptada cliente
      </Button>
      <Button
        onClick={() => setRejecting(true)}
        disabled={pending}
        variant="outline"
        size="sm"
      >
        Rechazar
      </Button>
      {rejecting && (
        <ReasonModal
          title="Rechazar propuesta"
          value={reason}
          onChange={setReason}
          onCancel={() => setRejecting(false)}
          onConfirm={reject}
          pending={pending}
        />
      )}
    </>
  );
}

function ReasonModal({
  title,
  value,
  onChange,
  onCancel,
  onConfirm,
  pending,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={() => !pending && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3 p-5">
          <h2 className="text-base font-bold">{title}</h2>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder="Motivo (opcional)"
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
            Confirmar
          </Button>
        </div>
      </div>
    </div>
  );
}
