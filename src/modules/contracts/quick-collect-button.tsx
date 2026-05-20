"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Banknote, CreditCard, Smartphone, Building2, Wrench, ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { collectContractPaymentSafeAction } from "./actions";

type When = "now" | "on_installation";
type Method = "cash" | "card" | "bizum" | "transfer";

const METHOD_LABEL: Record<Method, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
};

const METHOD_ICONS: Record<Method, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  card: CreditCard,
  bizum: Smartphone,
  transfer: Building2,
};

export function QuickCollectButton({
  paymentId,
  status,
  defaultMethod,
  amountLabel,
  canEditAfterCollect = false,
}: {
  paymentId: string;
  status: string;
  defaultMethod?: string;
  amountLabel?: string;
  /** Solo admin/director puede editar un cobro ya validado/cobrado. */
  canEditAfterCollect?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [when, setWhen] = useState<When | null>(null);
  const [method, setMethod] = useState<Method | null>(
    (defaultMethod as Method | undefined) ?? null,
  );
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Estados que aceptan acción: pending = cobrar, otros = editar cobro previo.
  const isEdit = status !== "pending";
  if (status === "rejected" || status === "cancelled") return null;
  // Si ya está cobrado y el usuario no es admin/director → no mostrar botón
  if (isEdit && !canEditAfterCollect) return null;

  function reset() {
    setOpen(false);
    setStep(1);
    setWhen(null);
    setMethod((defaultMethod as Method | undefined) ?? null);
    setNotes("");
  }

  function chooseWhen(w: When) {
    setWhen(w);
    setStep(2);
  }

  function chooseMethod(m: Method) {
    setMethod(m);
    setStep(3);
  }

  function confirm() {
    if (!when || !method) return;
    startTransition(async () => {
      const r = await collectContractPaymentSafeAction(paymentId, {
        when,
        method,
        notes: notes || undefined,
      });
      if (!r.ok) {
        notify.error("No se pudo cobrar", r.error);
        return;
      }
      notify.success(
        when === "on_installation"
          ? "Cobro aplazado a la instalación"
          : "Cobrado · pendiente de validar",
      );
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={pending}>
        {isEdit ? (
          <>
            <Pencil className="h-3 w-3" /> Editar cobro
          </>
        ) : (
          <>
            <Coins className="h-3 w-3" /> Cobrar
          </>
        )}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={reset}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b p-4">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                  className="rounded-full p-1 hover:bg-muted"
                  aria-label="Atrás"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h2 className="flex-1 text-base font-bold">
                {isEdit && step === 1 && "Editar · ¿Cuándo se cobra?"}
                {isEdit && step === 2 && "Editar · ¿Forma de pago?"}
                {isEdit && step === 3 && "Editar cobro"}
                {!isEdit && step === 1 && "¿Cuándo se cobra?"}
                {!isEdit && step === 2 && "¿Forma de pago?"}
                {!isEdit && step === 3 && "Confirmar cobro"}
              </h2>
              <span className="text-xs text-muted-foreground">Paso {step}/3</span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {amountLabel && (
                <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
                  Importe: <strong className="tabular-nums">{amountLabel}</strong>
                </div>
              )}

              {step === 1 && (
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => chooseWhen("now")}
                    className="flex items-center gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-left hover:border-emerald-500"
                  >
                    <Coins className="h-6 w-6 text-emerald-700" />
                    <div>
                      <div className="font-bold text-emerald-900">Cobrar ahora</div>
                      <div className="text-xs text-emerald-800">
                        Se registra en wallet con el método elegido.
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseWhen("on_installation")}
                    className="flex items-center gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-left hover:border-amber-500"
                  >
                    <Wrench className="h-6 w-6 text-amber-700" />
                    <div>
                      <div className="font-bold text-amber-900">En la instalación</div>
                      <div className="text-xs text-amber-800">
                        Se cobrará el día que el técnico instale. Queda marcado.
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(METHOD_LABEL) as Method[]).map((m) => {
                    const Icon = METHOD_ICONS[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => chooseMethod(m)}
                        className={`flex flex-col items-center gap-1 rounded-xl border-2 p-4 text-center hover:border-primary ${
                          method === m ? "border-primary bg-primary/5" : "border-border bg-card"
                        }`}
                      >
                        <Icon className="h-7 w-7" />
                        <span className="text-sm font-bold">{METHOD_LABEL[m]}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {step === 3 && when && method && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                    <div>
                      <strong>Cuándo:</strong>{" "}
                      {when === "now" ? "Cobrar ahora" : "En la instalación"}
                    </div>
                    <div>
                      <strong>Método:</strong> {METHOD_LABEL[method]}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="cobro-notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Notas (opcional)
                    </label>
                    <textarea
                      id="cobro-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm"
                      placeholder="Ej. nº de operación, banco, observaciones…"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button variant="outline" onClick={reset} disabled={pending}>
                Cancelar
              </Button>
              {step === 3 && (
                <Button onClick={confirm} disabled={pending} variant="success">
                  {pending
                    ? "Guardando…"
                    : isEdit
                      ? "Guardar cambios"
                      : "Confirmar cobro"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
