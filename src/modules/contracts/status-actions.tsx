"use client";

import { useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { markContractSigned } from "./actions";
import type { ContractStatus } from "./schemas";

interface Props {
  contractId: string;
  status: ContractStatus;
  hasProvisional: boolean;
}

/**
 * Acciones manuales del contrato. La activación NO se hace aquí — ocurre
 * automáticamente al completar la instalación (markContractActive se invoca
 * desde completeInstallation). Sólo mostramos botón firmar cuando aplica.
 */
export function ContractStatusActions({ contractId, status, hasProvisional }: Props) {
  const [pending, startTransition] = useTransition();

  function sign() {
    if (hasProvisional) {
      const ok = confirm(
        "El contrato tiene datos provisionales (DNI/CIF/IBAN). ¿Firmar igualmente?",
      );
      if (!ok) return;
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

  if (status === "draft" || status === "pending_data" || status === "pending_signature") {
    return (
      <div className="space-y-2">
        <Button onClick={sign} disabled={pending} className="w-full" variant="success" size="lg">
          <CheckCircle2 className="h-5 w-5" /> Marcar firmado
        </Button>
        <p className="text-xs text-muted-foreground">
          Al firmar se generan automáticamente las entradas wallet pendientes y se programa la
          instalación si procede.
        </p>
      </div>
    );
  }
  if (status === "signed") {
    return (
      <p className="text-sm text-muted-foreground">
        Firmado. Se activará automáticamente al completar la instalación.
      </p>
    );
  }
  if (status === "active") {
    return <p className="text-sm text-success">✓ Contrato activo</p>;
  }
  if (status === "completed") {
    return <p className="text-sm text-muted-foreground">Contrato completado.</p>;
  }
  if (status === "cancelled") {
    return <p className="text-sm text-destructive">Contrato cancelado.</p>;
  }
  return null;
}
