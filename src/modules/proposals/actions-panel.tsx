"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  markProposalAcceptedSafeAction,
  markProposalRejectedSafeAction,
  markProposalSentSafeAction,
  approveProposalSafeAction,
  rejectApprovalSafeAction,
  convertAcceptedProposalToCustomerSafeAction,
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
      const r = await markProposalSentSafeAction(proposalId);
      if (!r.ok) {
        notify.error("No se pudo marcar como enviada", r.error);
        return;
      }
      notify.success("Marcada como enviada");
      router.refresh();
    });
  }

  function accept() {
    startTransition(async () => {
      const r = await markProposalAcceptedSafeAction(proposalId);
      if (!r.ok) {
        notify.error("No se pudo aceptar", r.error);
        return;
      }
      notify.success("Propuesta aceptada");
      if (r.customer_id) {
        router.push(`/clientes/${r.customer_id}?from_proposal=${proposalId}` as never);
        return;
      }
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const r = await markProposalRejectedSafeAction(proposalId, reason);
      if (!r.ok) {
        notify.error("No se pudo rechazar", r.error);
        return;
      }
      notify.success("Rechazada");
      setRejecting(false);
      setReason("");
      router.refresh();
    });
  }

  function approve() {
    startTransition(async () => {
      const r = await approveProposalSafeAction(proposalId);
      if (!r.ok) {
        notify.error("No se pudo validar", r.error);
        return;
      }
      notify.success("Propuesta validada");
      router.refresh();
    });
  }

  function rejectApproval() {
    startTransition(async () => {
      const r = await rejectApprovalSafeAction(proposalId, reason);
      if (!r.ok) {
        notify.error("No se pudo rechazar la aprobación", r.error);
        return;
      }
      notify.success("Aprobación rechazada — vuelve a borrador");
      setRejectingApproval(false);
      setReason("");
      router.refresh();
    });
  }

  function passToContract() {
    startTransition(async () => {
      try {
        if (hasLead) {
          const r = await convertAcceptedProposalToCustomerSafeAction(proposalId);
          if (!r.ok) {
            notify.error("No se pudo convertir", r.error);
            return;
          }
          notify.success("Cliente creado. Completa sus datos y luego genera el contrato.");
          router.push(`/clientes/${r.customer_id}?from_proposal=${proposalId}` as never);
        } else {
          // createContractFromProposal usa NEXT_REDIRECT internamente — debe re-lanzar.
          await createContractFromProposal(proposalId);
        }
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("No se pudo generar el contrato", err instanceof Error ? err.message : String(err));
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={() => !pending && onCancel()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
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
        <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
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
