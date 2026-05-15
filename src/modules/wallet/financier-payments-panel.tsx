"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import {
  confirmFinancierPaymentAction,
  confirmReserveReleaseAction,
  type FinancierPaymentRow,
} from "./financier-payments-actions";

function eur(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function FinancierPaymentsPanel({
  initial,
}: {
  initial: FinancierPaymentRow[];
}) {
  const [items] = useState(initial);
  const pending = items.filter((i) => i.payment_state === "pending");
  const reservePending = items.filter((i) => i.payment_state === "reserve_pending");

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          ✅ Sin pagos de financiera pendientes. Cuando firmes un contrato
          renting o financiación, aparecerá aquí hasta que confirmes el cobro.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Clock className="h-4 w-4 text-amber-600" />
            Pagos pendientes ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <PaymentRow key={p.contract_id} row={p} mode="confirm" />
            ))}
          </div>
        </section>
      )}
      {reservePending.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Clock className="h-4 w-4 text-blue-600" />
            Reservas retenidas ({reservePending.length})
          </h2>
          <div className="space-y-2">
            {reservePending.map((p) => (
              <PaymentRow key={p.contract_id} row={p} mode="release_reserve" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PaymentRow({
  row,
  mode,
}: {
  row: FinancierPaymentRow;
  mode: "confirm" | "release_reserve";
}) {
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState(() => {
    if (mode === "confirm") {
      const expected = row.expected_payment_cents ?? 0;
      const reserve = row.expected_reserve_cents ?? 0;
      // Si hay reserva retenida, lo que entra al inicio es expected - reserve
      const netNow = Math.max(expected - reserve, 0);
      return (netNow / 100).toFixed(2);
    }
    return ((row.expected_reserve_cents ?? 0) / 100).toFixed(2);
  });
  const [hasReserveStill, setHasReserveStill] = useState(
    mode === "confirm" && (row.expected_reserve_cents ?? 0) > 0,
  );
  const [pending, startTransition] = useTransition();

  function submit() {
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents < 0) {
      notify.warning("Importe inválido");
      return;
    }
    startTransition(async () => {
      const r =
        mode === "confirm"
          ? await confirmFinancierPaymentAction({
              contract_id: row.contract_id,
              paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
              paid_amount_cents: cents,
              has_reserve_pending: hasReserveStill,
            })
          : await confirmReserveReleaseAction({
              contract_id: row.contract_id,
              paid_at: new Date(`${paidAt}T12:00:00`).toISOString(),
              paid_amount_cents: cents,
            });
      if (!r.ok) {
        notify.error("No se pudo confirmar", r.error);
        return;
      }
      notify.success(mode === "confirm" ? "Pago confirmado" : "Reserva liberada");
      location.reload();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/contratos/${row.contract_id}` as never}
              className="font-mono font-bold text-primary hover:underline"
            >
              {row.contract_reference ?? `#${row.contract_id.slice(0, 8)}`}
            </Link>
            <span>{row.customer_name}</span>
            <Badge variant="outline">{row.financier_name}</Badge>
            {row.financier_kind && (
              <Badge variant="secondary">
                {row.financier_kind === "renting_strict"
                  ? "Renting"
                  : "Financiación"}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={open ? "outline" : "success"}
            onClick={() => setOpen((o) => !o)}
            className="gap-1"
          >
            <CheckCircle2 className="h-4 w-4" />
            {open
              ? "Cancelar"
              : mode === "confirm"
                ? "Confirmar pago"
                : "Liberar reserva"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div>
            <span className="text-muted-foreground">Firmado:</span>{" "}
            {row.contract_signed_at
              ? new Date(row.contract_signed_at).toLocaleDateString("es-ES", {
                  timeZone: "Europe/Madrid",
                })
              : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Capital esperado:</span>{" "}
            <strong className="tabular-nums">
              {eur(row.expected_payment_cents)}
            </strong>
          </div>
          {row.expected_reserve_cents != null && (
            <div>
              <span className="text-muted-foreground">Reserva:</span>{" "}
              <strong className="tabular-nums">
                {eur(row.expected_reserve_cents)}
              </strong>
            </div>
          )}
        </div>

        {open && (
          <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha de cobro</Label>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Importe recibido (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            {mode === "confirm" && (row.expected_reserve_cents ?? 0) > 0 && (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={hasReserveStill}
                  onChange={(e) => setHasReserveStill(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Queda <strong>reserva pendiente</strong> (
                  {eur(row.expected_reserve_cents)}) — el contrato pasará a
                  «Reserva pendiente» hasta que la financiera la libere.
                </span>
              </label>
            )}
            <div className="flex justify-end">
              <Button
                onClick={submit}
                disabled={pending}
                variant="success"
                className="gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {pending ? "Guardando..." : "Confirmar"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
