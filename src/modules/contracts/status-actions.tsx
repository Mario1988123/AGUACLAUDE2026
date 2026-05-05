"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { PreSignContractModal } from "./pre-sign-modal";
import type { ContractStatus } from "./schemas";

interface Props {
  contractId: string;
  status: ContractStatus;
  hasProvisional: boolean;
}

/**
 * Acción "Marcar firmado". Antes de firmar abre PreSignContractModal
 * que valida datos críticos del cliente (DNI, IBAN, dirección, foto DNI).
 *
 * La activación NO se hace aquí — ocurre automáticamente al completar la
 * instalación (markContractActive se invoca desde completeInstallation).
 */
export function ContractStatusActions({ contractId, status, hasProvisional }: Props) {
  const [open, setOpen] = useState(false);
  void hasProvisional;

  if (status === "draft" || status === "pending_data" || status === "pending_signature") {
    return (
      <div className="space-y-2">
        <Button
          onClick={() => setOpen(true)}
          className="w-full"
          variant="success"
          size="lg"
        >
          <CheckCircle2 className="h-5 w-5" /> Marcar firmado
        </Button>
        <p className="text-xs text-muted-foreground">
          Al pulsar verás los datos del cliente. Si falta algo crítico
          (DNI, IBAN, dirección) lo completas en el mismo modal antes de
          firmar.
        </p>
        {open && (
          <PreSignContractModal
            contractId={contractId}
            onClose={() => setOpen(false)}
          />
        )}
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
