"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { createInvoiceFromContractAction } from "./actions";

export function InvoiceFromContractButton({ contractId }: { contractId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function go() {
    if (!confirm("¿Generar factura desde este contrato?")) return;
    startTransition(async () => {
      try {
        const id = await createInvoiceFromContractAction(contractId);
        notify.success("Factura creada en borrador");
        router.push(`/facturas/${id}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <Button onClick={go} disabled={pending} variant="outline" className="gap-2">
      <Receipt className="h-4 w-4" /> Facturar
    </Button>
  );
}
