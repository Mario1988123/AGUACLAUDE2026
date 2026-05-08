"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  rejectWalletEntryAction,
  validateWalletEntryAction,
  markWalletAsCollectedAction,
  cancelWalletEntryAction,
  changeWalletMethodAction,
  createInvoiceFromWalletAction,
} from "./actions";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";

interface Props {
  id: string;
  status: string;
  method: string;
  canValidate: boolean;
  /** true si este wallet_entry NO tiene invoice_id (sin facturar) */
  needsInvoice?: boolean;
  /** true si el usuario es admin (puede facturar) */
  canInvoice?: boolean;
}

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "bizum", label: "Bizum" },
  { value: "transfer", label: "Transferencia" },
  { value: "direct_debit", label: "Domiciliación" },
  { value: "financing", label: "Financiación" },
];

export function ValidateWalletButtons({
  id,
  status,
  method,
  canValidate,
  needsInvoice = false,
  canInvoice = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reasonOpen, setReasonOpen] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [newMethod, setNewMethod] = useState(method);

  function invoice() {
    startTransition(async () => {
      const r = await createInvoiceFromWalletAction(id);
      if (!r.ok) {
        notify.error("No se pudo facturar", r.error);
        return;
      }
      notify.success("Factura creada", "Borrador listo para revisar y emitir.");
      router.push(`/facturas/${r.invoice_id}` as never);
    });
  }

  const isCollected = status === "collected" || status === "pending_settlement";
  const isPending = status === "pending";
  const isRejected = status === "rejected" || status === "cancelled";

  function validate() {
    startTransition(async () => {
      try {
        await validateWalletEntryAction(id);
        notify.success("Cobro validado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function markCollected() {
    startTransition(async () => {
      try {
        await markWalletAsCollectedAction(id);
        notify.success("Marcado como cobrado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function confirmReason() {
    const r = reason.trim();
    if (!r) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      try {
        if (reasonOpen === "reject") {
          await rejectWalletEntryAction(id, r);
          notify.success("Cobro rechazado");
        } else {
          await cancelWalletEntryAction(id, r);
          notify.success("Cobro cancelado");
        }
        setReasonOpen(null);
        setReason("");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function changeMethod() {
    if (newMethod === method) {
      setMethodOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await changeWalletMethodAction(id, newMethod);
        notify.success("Método actualizado");
        setMethodOpen(false);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Quién puede cambiar el método: pending = todos; resto = solo admin/director
  const canEditMethod = isPending || canValidate;

  // Pending → todos pueden marcar como cobrado; admin puede cancelar
  // Collected/pending_settlement → admin valida o rechaza
  // Rejected/cancelled → admin puede reabrir como cobrado
  if (!isCollected && !isPending && !isRejected) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">
        {canEditMethod && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setNewMethod(method);
              setMethodOpen(true);
            }}
            disabled={pending}
          >
            Cambiar método
          </Button>
        )}
        {isCollected && canValidate && (
          <>
            <Button size="sm" variant="success" onClick={validate} disabled={pending}>
              {method === "cash" ? "Recibí el efectivo" : "Confirmado en banco"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReasonOpen("reject")}
              disabled={pending}
            >
              Rechazar
            </Button>
          </>
        )}
        {isPending && (
          <Button size="sm" variant="success" onClick={markCollected} disabled={pending}>
            Marcar cobrado
          </Button>
        )}
        {isPending && canValidate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReasonOpen("cancel")}
            disabled={pending}
          >
            Cancelar
          </Button>
        )}
        {isRejected && canValidate && (
          <Button size="sm" variant="outline" onClick={markCollected} disabled={pending}>
            Reabrir como cobrado
          </Button>
        )}
        {needsInvoice && canInvoice && (isCollected || (status as string) === "validated") && (
          <Button size="sm" variant="success" onClick={invoice} disabled={pending} className="gap-1">
            <Receipt className="h-3 w-3" /> Facturar
          </Button>
        )}
      </div>
      {reasonOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!pending) {
              setReasonOpen(null);
              setReason("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">
                {reasonOpen === "reject" ? "Motivo del rechazo" : "Motivo de la cancelación"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {reasonOpen === "reject"
                  ? "Explica brevemente por qué rechazas este cobro."
                  : "Explica por qué se cancela (cliente no paga, error de registro…)."}
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                autoFocus
                placeholder={
                  reasonOpen === "reject"
                    ? "Importe incorrecto, justificante ilegible…"
                    : "El cliente nunca pasó por la oficina…"
                }
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => {
                  setReasonOpen(null);
                  setReason("");
                }}
                disabled={pending}
              >
                Volver
              </Button>
              <Button variant="destructive" onClick={confirmReason} disabled={pending}>
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}

      {methodOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setMethodOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">Cambiar método de cobro</h2>
              <p className="text-xs text-muted-foreground">
                {isPending
                  ? "El cobro está pendiente — puedes cambiar el método antes de confirmarlo."
                  : "El cobro ya está registrado. Cambiar el método queda en el log de auditoría."}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {METHOD_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setNewMethod(m.value)}
                    className={`rounded-xl border-2 p-3 text-sm font-bold ${
                      newMethod === m.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setMethodOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={changeMethod} disabled={pending} variant="success">
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
