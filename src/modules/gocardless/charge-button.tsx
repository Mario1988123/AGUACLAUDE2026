"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createPaymentAction, type MandateOption } from "./actions";

/**
 * Botón "Cobrar por GoCardless" que abre un dialog con la lista de
 * mandatos activos del cliente y un campo de importe.
 */
export function ChargeWithGoCardlessButton({
  mandates,
  defaultAmountCents,
  description,
  contractId,
  invoiceId,
  contractPaymentId,
  size = "default",
}: {
  mandates: MandateOption[];
  defaultAmountCents: number;
  description: string;
  contractId?: string;
  invoiceId?: string;
  contractPaymentId?: string;
  size?: "default" | "sm" | "lg";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mandateId, setMandateId] = useState<string>(mandates[0]?.id ?? "");
  const [amount, setAmount] = useState((defaultAmountCents / 100).toFixed(2));

  function submit() {
    const amt = Math.round(Number(amount) * 100);
    if (!amt || amt <= 0) {
      notify.warning("Importe inválido");
      return;
    }
    if (!mandateId) {
      notify.warning("Selecciona un mandato");
      return;
    }
    startTransition(async () => {
      try {
        await createPaymentAction({
          mandate_id: mandateId,
          amount_cents: amt,
          description,
          contract_id: contractId ?? null,
          invoice_id: invoiceId ?? null,
          contract_payment_id: contractPaymentId ?? null,
        });
        notify.success(
          "Cobro creado",
          "GoCardless lo procesará y notificará al CRM cuando se confirme.",
        );
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (mandates.length === 0) {
    return (
      <Button
        size={size}
        variant="outline"
        disabled
        title="El cliente no tiene mandato activo. Genera uno desde la ficha del cliente."
        className="gap-2"
      >
        <CreditCard className="h-4 w-4" /> Domiciliar (sin mandato)
      </Button>
    );
  }

  return (
    <>
      <Button size={size} onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <CreditCard className="h-4 w-4" /> Cobrar por domiciliación
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-4 p-5">
              <h2 className="text-base font-bold">Cobrar por GoCardless</h2>
              <div className="grid gap-2">
                <Label>Cuenta a cobrar</Label>
                <select
                  value={mandateId}
                  onChange={(e) => setMandateId(e.target.value)}
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {mandates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Importe (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Se enviará la orden a GoCardless. El cobro se confirmará en banco en 2-7 días según
                el banco del cliente. El estado se actualizará automáticamente en el wallet.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                {pending ? "Enviando…" : "Cobrar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
