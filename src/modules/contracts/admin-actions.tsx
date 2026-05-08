"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Ban, Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { validateContractAction, cancelContractAction } from "./actions";

/**
 * Botones admin/director en el detalle de contrato:
 * - Validar (firma financiera OK) → solo cuando status signed/active
 * - Cancelar contrato → con modal de motivo, bloqueado si hay instalación
 *   en curso o completada (lo valida el server)
 * - Editar IBAN → link a la sección de IBAN del cliente para cambiarlo
 *   incluso después de firmado
 */
export function ContractAdminActions({
  contractId,
  customerId,
  status,
  validatedAt,
  cancelledAt,
  hasIban,
  ibanIsPending,
  needsValidation,
  canValidate,
  canCancel,
}: {
  contractId: string;
  customerId: string | null;
  status: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  hasIban: boolean;
  ibanIsPending: boolean;
  /** true si plan = alquiler/renting (necesita validación financiera). */
  needsValidation: boolean;
  /** admin/director comercial puede validar */
  canValidate: boolean;
  /** admin puede cancelar */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const isCancelled = !!cancelledAt;
  const isValidated = !!validatedAt;
  const isSigned = status === "signed" || status === "active";

  function validate() {
    startTransition(async () => {
      const r = await validateContractAction(contractId);
      if (!r.ok) {
        notify.error("No se pudo validar", r.error);
        return;
      }
      notify.success("Contrato validado");
      router.refresh();
    });
  }

  function cancel() {
    if (!reason.trim()) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      const r = await cancelContractAction(contractId, reason.trim());
      if (!r.ok) {
        notify.error("No se pudo cancelar", r.error);
        return;
      }
      notify.success("Contrato cancelado");
      setCancelOpen(false);
      router.push("/contratos" as never);
    });
  }

  if (isCancelled) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
        ❌ Contrato cancelado el {new Date(cancelledAt).toLocaleDateString("es-ES")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Validar (renting/alquiler firmado pendiente de financiera) */}
      {needsValidation && isSigned && !isValidated && canValidate && (
        <Button
          onClick={validate}
          disabled={pending}
          variant="success"
          className="w-full gap-2"
        >
          <Check className="h-4 w-4" />
          Validar (financiera OK)
        </Button>
      )}
      {needsValidation && isValidated && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ✓ Validado por financiera el{" "}
          {new Date(validatedAt).toLocaleDateString("es-ES")}
        </div>
      )}

      {/* Editar IBAN — siempre disponible si hay cliente, especialmente útil
          si el IBAN actual es ES00 (pending) */}
      {customerId && (
        <Button asChild variant="outline" className="w-full gap-2">
          <Link href={`/clientes/${customerId}#iban` as never}>
            <Pencil className="h-4 w-4" />
            {ibanIsPending || !hasIban ? "Añadir IBAN real" : "Editar IBAN"}
          </Link>
        </Button>
      )}

      {/* Cancelar */}
      {canCancel && status !== "cancelled" && (
        <Button
          onClick={() => setCancelOpen(true)}
          disabled={pending}
          variant="ghost"
          className="w-full gap-2 text-destructive"
        >
          <Ban className="h-4 w-4" /> Cancelar contrato
        </Button>
      )}

      {cancelOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setCancelOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">Cancelar contrato</h2>
              <p className="text-sm text-muted-foreground">
                Si hay instalaciones pendientes se cancelarán también. Si hay alguna
                instalación en curso o completada, no podrás cancelar el contrato.
                Esta acción no se puede deshacer.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Cliente se ha echado atrás, error en datos…"
                className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={pending}>
                Volver
              </Button>
              <Button variant="destructive" onClick={cancel} disabled={pending}>
                Cancelar contrato
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
