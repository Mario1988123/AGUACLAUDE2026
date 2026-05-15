"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, HandCoins } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  approveExpenseAction,
  rejectExpenseAction,
  reimburseExpenseAction,
} from "./actions";

export function ApprovalButtons({
  expenseId,
  status,
  paymentMethod,
  totalCents,
  canApprove,
}: {
  expenseId: string;
  status: string;
  paymentMethod: string;
  totalCents: number;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reimburseOpen, setReimburseOpen] = useState(false);
  const [amount, setAmount] = useState((totalCents / 100).toFixed(2));
  const [bankRef, setBankRef] = useState("");
  const [notes, setNotes] = useState("");

  if (!canApprove) {
    return (
      <p className="text-xs text-muted-foreground">
        Solo el administrador o el director comercial puede aprobar este gasto.
      </p>
    );
  }

  function approve() {
    startTransition(async () => {
      try {
        await approveExpenseAction(expenseId);
        notify.success(
          paymentMethod === "corp_card"
            ? "Gasto validado"
            : "Aprobado · pendiente de liquidar al comercial",
        );
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reject() {
    if (!reason.trim()) {
      notify.warning("Indica el motivo del rechazo");
      return;
    }
    startTransition(async () => {
      try {
        await rejectExpenseAction(expenseId, reason.trim());
        notify.success("Gasto rechazado");
        setRejectOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function reimburse() {
    const amt = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(amt) || amt <= 0) {
      notify.warning("Importe inválido");
      return;
    }
    startTransition(async () => {
      try {
        await reimburseExpenseAction(expenseId, {
          amount_cents: amt,
          bank_ref: bankRef || undefined,
          notes: notes || undefined,
        });
        notify.success("Liquidación registrada");
        setReimburseOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-2">
      {status === "submitted" && (
        <>
          <Button onClick={approve} disabled={pending} className="w-full gap-2" variant="success">
            <Check className="h-4 w-4" />
            {paymentMethod === "corp_card" ? "Validar (tarjeta empresa)" : "Aprobar"}
          </Button>
          <Button
            onClick={() => setRejectOpen(true)}
            disabled={pending}
            variant="outline"
            className="w-full gap-2 text-destructive"
          >
            <X className="h-4 w-4" /> Rechazar
          </Button>
        </>
      )}
      {status === "approved" && paymentMethod !== "corp_card" && (
        <Button
          onClick={() => setReimburseOpen(true)}
          disabled={pending}
          variant="success"
          className="w-full gap-2"
        >
          <HandCoins className="h-4 w-4" /> Liquidar al comercial
        </Button>
      )}
      {status === "reimbursed" && (
        <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
          ✓ Gasto liquidado al comercial.
        </p>
      )}
      {status === "reconciled" && (
        <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
          ✓ Gasto pagado con tarjeta de empresa y validado.
        </p>
      )}
      {status === "rejected" && (
        <p className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
          Gasto rechazado.
        </p>
      )}

      {rejectOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setRejectOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-base font-bold">Motivo del rechazo</h2>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                autoFocus
                placeholder="Falta el ticket, no es deducible, no corresponde…"
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button variant="destructive" onClick={reject} disabled={pending}>
                Rechazar
              </Button>
            </div>
          </div>
        </div>
      )}

      {reimburseOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setReimburseOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-base font-bold">Liquidar al comercial</h2>
              <p className="text-xs text-muted-foreground">
                Ya has aprobado el gasto. Registra aquí cuando le hagas la transferencia.
              </p>
              <div className="space-y-1">
                <Label>Importe a reembolsar (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Referencia bancaria (opcional)</Label>
                <Input
                  value={bankRef}
                  onChange={(e) => setBankRef(e.target.value)}
                  placeholder="Nº de operación"
                />
              </div>
              <div className="space-y-1">
                <Label>Notas (opcional)</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setReimburseOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button variant="success" onClick={reimburse} disabled={pending}>
                Confirmar liquidación
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
