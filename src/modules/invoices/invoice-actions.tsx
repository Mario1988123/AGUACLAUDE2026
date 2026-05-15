"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, CheckCircle2, Ban, FileMinus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  markInvoiceIssuedAction,
  markInvoicePaidAction,
  cancelInvoiceAction,
  createCreditNoteAction,
  type InvoiceStatus,
  type InvoiceKind,
} from "./actions";

function eur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function InvoiceActions({
  invoiceId,
  status,
  kind,
  pendingCents,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  kind: InvoiceKind;
  pendingCents: number;
}) {
  const [pending, startTransition] = useTransition();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState((pendingCents / 100).toFixed(2));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const router = useRouter();
  const ask = useConfirm();

  function issue() {
    startTransition(async () => {
      try {
        await markInvoiceIssuedAction(invoiceId);
        notify.success("Factura emitida");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function pay() {
    const amt = Math.round(Number(amount) * 100);
    if (!amt || amt <= 0) {
      notify.warning("Importe inválido");
      return;
    }
    startTransition(async () => {
      try {
        await markInvoicePaidAction(invoiceId, amt);
        notify.success("Cobro registrado");
        setPaying(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function confirmCancel() {
    const reason = cancelReason.trim();
    startTransition(async () => {
      try {
        await cancelInvoiceAction(invoiceId, reason);
        notify.success("Factura cancelada");
        setCancelOpen(false);
        setCancelReason("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function rectify() {
    const ok = await ask({
      message:
        "Crear factura rectificativa que anula esta. Las líneas se copiarán en negativo. ¿Continuar?",
      confirmText: "Crear rectificativa",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const newId = await createCreditNoteAction(invoiceId);
        notify.success("Rectificativa creada");
        router.push(`/facturas/${newId}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-2">
      {status === "draft" && (
        <Button onClick={issue} disabled={pending} className="w-full gap-2" variant="success">
          <Send className="h-4 w-4" /> Emitir
        </Button>
      )}
      {(status === "issued" || status === "overdue") && pendingCents > 0 && (
        <>
          {!paying ? (
            <Button onClick={() => setPaying(true)} disabled={pending} className="w-full gap-2">
              <CheckCircle2 className="h-4 w-4" /> Marcar cobrada ({eur(pendingCents)})
            </Button>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <Label className="text-xs">Importe del cobro (€)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPaying(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={pay} disabled={pending} variant="success">
                  Confirmar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Crea una entrada de wallet validada por el importe indicado.
              </p>
            </div>
          )}
        </>
      )}
      {kind !== "credit_note" && status !== "cancelled" && (
        <Button onClick={rectify} disabled={pending} variant="outline" className="w-full gap-2">
          <FileMinus className="h-4 w-4" /> Crear rectificativa
        </Button>
      )}
      {status !== "cancelled" && status !== "paid" && (
        <Button
          onClick={() => setCancelOpen(true)}
          disabled={pending}
          variant="ghost"
          className="w-full gap-2 text-destructive"
        >
          <Ban className="h-4 w-4" /> Cancelar
        </Button>
      )}

      {cancelOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => {
            if (!pending) {
              setCancelOpen(false);
              setCancelReason("");
            }
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-base font-bold">Cancelar factura</h2>
              <p className="text-sm text-muted-foreground">
                Indica el motivo (opcional). Esta acción no se puede deshacer.
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Motivo de la cancelación…"
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => {
                  setCancelOpen(false);
                  setCancelReason("");
                }}
                disabled={pending}
              >
                Volver
              </Button>
              <Button variant="destructive" onClick={confirmCancel} disabled={pending}>
                Cancelar factura
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
