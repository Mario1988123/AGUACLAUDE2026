"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, CheckCircle2, Ban, FileMinus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
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
  const router = useRouter();

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

  function cancel() {
    const reason = prompt("Motivo de la cancelación (opcional):") ?? "";
    if (!confirm("¿Cancelar esta factura?")) return;
    startTransition(async () => {
      try {
        await cancelInvoiceAction(invoiceId, reason);
        notify.success("Factura cancelada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function rectify() {
    if (
      !confirm(
        "Crear factura rectificativa que anula esta. Las líneas se copiarán en negativo. ¿Continuar?",
      )
    )
      return;
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
        <Button onClick={cancel} disabled={pending} variant="ghost" className="w-full gap-2 text-destructive">
          <Ban className="h-4 w-4" /> Cancelar
        </Button>
      )}
    </div>
  );
}
