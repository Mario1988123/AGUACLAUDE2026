"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { createInvoiceForFinancierFromContractAction } from "./actions";

/**
 * Emite una factura a la FINANCIERA por el capital empresa del contrato
 * (renting estricto / financiación). Distinto del botón estándar
 * "Facturar" — ese factura al cliente final.
 */
export function InvoiceToFinancierButton({
  contractId,
  financierName,
}: {
  contractId: string;
  financierName: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  async function go() {
    const ok = await ask({
      title: "Facturar a la financiera",
      message: `Se emitirá la factura del capital empresa a "${financierName}" (base + IVA 21%). ¿Continuar?`,
      confirmText: "Emitir factura",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const id = await createInvoiceForFinancierFromContractAction(contractId);
        notify.success("Factura emitida", "Borrador listo. Revísala y valida.");
        router.push(`/facturas/${id}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <Button onClick={go} disabled={pending} variant="outline" className="gap-2">
      <Banknote className="h-4 w-4" /> Facturar a financiera
    </Button>
  );
}
