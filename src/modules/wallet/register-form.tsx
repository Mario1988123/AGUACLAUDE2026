"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createWalletEntryAction } from "./actions";
import { PAYMENT_METHOD, type PaymentMethod } from "./schemas";
import { METHOD_LABEL } from "./constants";

interface Props {
  contractId?: string;
  customerId?: string;
  installationId?: string;
  defaultConcept?: string;
  defaultAmountCents?: number;
  onDone?: () => void;
}

export function RegisterPaymentForm({
  contractId,
  customerId,
  installationId,
  defaultConcept,
  defaultAmountCents,
  onDone,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    concept: defaultConcept ?? "",
    amount_euros: defaultAmountCents ? (defaultAmountCents / 100).toFixed(2) : "",
    method: "cash" as PaymentMethod,
    notes: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount_cents = Math.round(Number(form.amount_euros) * 100);
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
      notify.warning("Importe no válido");
      return;
    }
    startTransition(async () => {
      try {
        await createWalletEntryAction({
          contract_id: contractId,
          customer_id: customerId,
          installation_id: installationId,
          concept: form.concept,
          amount_cents,
          method: form.method,
          notes: form.notes,
        });
        notify.success("Cobro registrado");
        setForm({ concept: "", amount_euros: "", method: "cash", notes: "" });
        onDone?.();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="concept">Concepto *</Label>
          <Input
            id="concept"
            required
            value={form.concept}
            onChange={(e) => setForm({ ...form, concept: e.target.value })}
            placeholder="Fianza, Primera cuota, Pago contado..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Importe (€) *</Label>
          <Input
            id="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
            value={form.amount_euros}
            onChange={(e) => setForm({ ...form, amount_euros: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Método de pago *</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAYMENT_METHOD.map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-center justify-center rounded-xl border-2 p-3 text-sm font-semibold transition-colors ${
                form.method === m
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={form.method === m}
                onChange={() => setForm({ ...form, method: m })}
                className="sr-only"
              />
              {METHOD_LABEL[m] ?? m}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notas</Label>
        <textarea
          id="notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full rounded-xl border border-border bg-card p-3 text-sm"
          placeholder="Justificante, observaciones..."
        />
      </div>

      <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        {form.method === "cash"
          ? "🟡 Efectivo: queda pendiente de liquidar con admin/director."
          : "🔵 Tarjeta/Bizum/Transferencia: queda pendiente de validar por admin/director."}
      </div>

      <div className="flex justify-end gap-2">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={pending} variant="success">
          {pending ? "Registrando..." : "Registrar cobro"}
        </Button>
      </div>
    </form>
  );
}
