"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Smartphone,
  Building2,
  Wrench,
  Coins,
  CheckCircle2,
  Pencil,
  Briefcase,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { collectContractPaymentAction } from "./actions";

type When = "now" | "on_installation" | "at_office";
type Method = "cash" | "card" | "bizum" | "transfer";

const METHOD_LABEL: Record<Method, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
};

const METHOD_ICON: Record<Method, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  card: CreditCard,
  bizum: Smartphone,
  transfer: Building2,
};

/**
 * Versión inline del cobro para usar dentro del wizard. Sin modal: dos
 * botones de momento + 4 botones de método + confirmar. Compacto.
 */
export function CollectInline({
  paymentId,
  status,
  defaultMethod,
  amountLabel,
}: {
  paymentId: string;
  status: string;
  defaultMethod?: string;
  amountLabel?: string;
}) {
  const isEdit = status !== "pending";
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<When>("now");
  const [method, setMethod] = useState<Method>(
    (defaultMethod as Method | undefined) ?? "cash",
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    startTransition(async () => {
      try {
        if (when === "at_office") {
          // Reusa el flujo "diferido" pero deja anotado que el cobro es
          // en oficina — no materializa wallet entry hasta que el
          // comercial lo confirme cuando reciba el dinero.
          await collectContractPaymentAction(paymentId, {
            when: "on_installation",
            method,
            notes: "Pago en oficina · pendiente de cobro real",
          });
          notify.success("Marcado: pago en oficina pendiente");
        } else {
          await collectContractPaymentAction(paymentId, { when, method });
          notify.success(
            when === "on_installation"
              ? "Cobro aplazado a la instalación"
              : "Cobrado · pendiente de validar",
          );
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={pending}>
        {isEdit ? (
          <>
            <Pencil className="h-3 w-3" /> Editar cobro
          </>
        ) : (
          <>
            <Coins className="h-3 w-3" /> Marcar cobro
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
      {amountLabel && (
        <div className="text-xs text-muted-foreground">
          Importe: <strong className="tabular-nums text-foreground">{amountLabel}</strong>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          ¿Cuándo?
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setWhen("now")}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs font-bold ${
              when === "now"
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-border bg-card hover:border-emerald-300"
            }`}
          >
            <Coins className="h-4 w-4" /> Ahora
          </button>
          <button
            type="button"
            onClick={() => setWhen("at_office")}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs font-bold ${
              when === "at_office"
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-border bg-card hover:border-blue-300"
            }`}
          >
            <Briefcase className="h-4 w-4" /> En oficina
          </button>
          <button
            type="button"
            onClick={() => setWhen("on_installation")}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs font-bold ${
              when === "on_installation"
                ? "border-amber-500 bg-amber-50 text-amber-700"
                : "border-border bg-card hover:border-amber-300"
            }`}
          >
            <Wrench className="h-4 w-4" /> En la instalación
          </button>
        </div>
      </div>
      {when === "at_office" && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800">
          ℹ El cliente pagará en oficina. Queda registrado como pendiente — el
          comercial validará el cobro cuando reciba el dinero.
        </p>
      )}
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Método
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(METHOD_LABEL) as Method[]).map((m) => {
            const Icon = METHOD_ICON[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex flex-col items-center gap-0.5 rounded-xl border-2 p-2 text-xs font-bold ${
                  method === m
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <Icon className="h-4 w-4" />
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={confirm} disabled={pending} variant="success">
          <CheckCircle2 className="h-3 w-3" />
          {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Confirmar cobro"}
        </Button>
      </div>
    </div>
  );
}
