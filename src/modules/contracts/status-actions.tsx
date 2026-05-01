"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markContractActive, markContractSigned } from "./actions";
import type { ContractStatus } from "./schemas";

interface Props {
  contractId: string;
  status: ContractStatus;
  hasProvisional: boolean;
}

export function ContractStatusActions({ contractId, status, hasProvisional }: Props) {
  const [pending, startTransition] = useTransition();

  function sign() {
    if (hasProvisional) {
      notify.warning(
        "Aviso",
        "El contrato tiene datos provisionales (DNI/CIF/IBAN). Confirma antes de firmar.",
      );
    }
    startTransition(async () => {
      try {
        await markContractSigned(contractId);
        notify.success("Contrato firmado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function activate() {
    startTransition(async () => {
      try {
        await markContractActive(contractId);
        notify.success("Contrato activo");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-2">
      {(status === "draft" || status === "pending_data" || status === "pending_signature") && (
        <Button onClick={sign} disabled={pending} className="w-full" variant="success">
          Marcar firmado
        </Button>
      )}
      {status === "signed" && (
        <Button onClick={activate} disabled={pending} className="w-full">
          Activar
        </Button>
      )}
      {status === "active" && (
        <p className="text-sm text-success">Contrato activo. Listo para programar instalación.</p>
      )}
      {status === "completed" && (
        <p className="text-sm text-muted-foreground">Contrato completado.</p>
      )}
    </div>
  );
}
