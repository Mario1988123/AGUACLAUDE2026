"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { rejectWalletEntryAction, validateWalletEntryAction } from "./actions";

interface Props {
  id: string;
  canValidate: boolean;
}

export function ValidateWalletButtons({ id, canValidate }: Props) {
  const [pending, startTransition] = useTransition();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!canValidate) return null;

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

  function confirmReject() {
    const r = reason.trim();
    if (!r) {
      notify.warning("Indica el motivo del rechazo");
      return;
    }
    startTransition(async () => {
      try {
        await rejectWalletEntryAction(id, r);
        notify.success("Cobro rechazado");
        setReasonOpen(false);
        setReason("");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <div className="flex gap-1.5">
        <Button size="sm" variant="success" onClick={validate} disabled={pending}>
          Validar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setReasonOpen(true)} disabled={pending}>
          Rechazar
        </Button>
      </div>
      {reasonOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!pending) {
              setReasonOpen(false);
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
              <h2 className="text-base font-bold">Motivo del rechazo</h2>
              <p className="text-sm text-muted-foreground">
                Explica brevemente por qué rechazas este cobro.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                autoFocus
                placeholder="Importe incorrecto, justificante ilegible…"
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => {
                  setReasonOpen(false);
                  setReason("");
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button variant="destructive" onClick={confirmReject} disabled={pending}>
                Rechazar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
