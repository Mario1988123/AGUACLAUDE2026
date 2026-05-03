"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, FileSignature } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { createContractFromProposal } from "@/modules/contracts/actions";

interface Props {
  proposalId: string;
  /** Pendientes detectados en el cliente. */
  pending: { dni: boolean; iban: boolean; address: boolean };
}

/**
 * Banner que aparece en la ficha de cliente cuando llegamos desde una
 * propuesta aceptada (?from_proposal=…). Le explica al comercial qué
 * datos faltan y le da un botón "Generar contrato" para cuando esté
 * listo. Si faltan datos críticos avisa pero permite continuar (datos
 * provisionales — el contrato queda en pending_data hasta firma).
 */
export function FromProposalBanner({ proposalId, pending }: Props) {
  const [pendingTx, startTransition] = useTransition();
  const router = useRouter();

  function generate() {
    startTransition(async () => {
      try {
        await createContractFromProposal(proposalId);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  const missing: string[] = [];
  if (pending.dni) missing.push("DNI/CIF");
  if (pending.iban) missing.push("cuenta bancaria");
  if (pending.address) missing.push("dirección principal");
  const ready = missing.length === 0;

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border-2 p-4 ${
        ready
          ? "border-emerald-300 bg-emerald-50"
          : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full ${
            ready ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"
          }`}
        >
          <ArrowRight className="h-5 w-5" />
        </div>
        <div>
          <h3 className={`font-bold ${ready ? "text-emerald-900" : "text-amber-900"}`}>
            {ready
              ? "Cliente creado desde propuesta aceptada"
              : "Completa los datos del cliente antes del contrato"}
          </h3>
          {!ready ? (
            <p className="mt-1 text-sm text-amber-800">
              Faltan: <strong>{missing.join(", ")}</strong>. Puedes completarlos abajo (el
              contrato se puede generar igual y queda como &laquo;pendiente de datos&raquo;).
            </p>
          ) : (
            <p className="mt-1 text-sm text-emerald-800">
              Todos los datos críticos están completos. Pulsa &laquo;Generar contrato&raquo;.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => router.push(`/propuestas/${proposalId}` as never)}
          disabled={pendingTx}
        >
          <ChevronLeft className="h-4 w-4" />
          Volver a propuesta
        </Button>
        <Button onClick={generate} disabled={pendingTx} variant="success" className="gap-2">
          <FileSignature className="h-4 w-4" />
          {pendingTx ? "Generando…" : "Generar contrato"}
        </Button>
      </div>
    </div>
  );
}
