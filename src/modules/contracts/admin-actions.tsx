"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Pencil } from "lucide-react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { cancelContractAction } from "./actions";

/**
 * Botones admin/director en el detalle de contrato:
 * - Editar IBAN → link a la sección de IBAN del cliente para cambiarlo
 *   incluso después de firmado.
 * - Cancelar contrato → con modal de motivo, bloqueado si hay instalación
 *   en curso o completada (lo valida el server).
 *
 * Renting/alquiler: si IBAN es ES00 (pendiente) el contrato queda firmado
 * pero pendiente de datos. No hay validación de financiera (decisión
 * usuario 2026-05-08: se revisa manual).
 */
export function ContractAdminActions({
  contractId,
  customerId,
  status,
  cancelledAt,
  hasIban,
  ibanIsPending,
  canCancel,
}: {
  contractId: string;
  customerId: string | null;
  status: string;
  cancelledAt: string | null;
  hasIban: boolean;
  ibanIsPending: boolean;
  /** admin puede cancelar */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const isCancelled = !!cancelledAt;

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
      {/* IBAN pendiente: aviso visible hasta que se complete */}
      {ibanIsPending && hasIban && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ Contrato firmado · pendiente de IBAN (actual: ES00)
        </div>
      )}

      {/* Editar IBAN — siempre disponible si hay cliente */}
      {customerId && (
        <Button asChild variant="outline" className="w-full gap-2">
          <Link href={`/clientes/${customerId}#iban` as never}>
            <Pencil className="h-4 w-4" />
            {ibanIsPending || !hasIban ? "Añadir IBAN" : "Editar IBAN"}
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
