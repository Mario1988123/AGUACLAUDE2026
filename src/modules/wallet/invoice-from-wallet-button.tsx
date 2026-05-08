"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { createInvoiceFromWalletAction } from "./actions";

export function InvoiceFromWalletButton({ walletId }: { walletId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      const r = await createInvoiceFromWalletAction(walletId);
      if (!r.ok) {
        notify.error("No se pudo facturar", r.error);
        return;
      }
      notify.success("Factura creada", "Borrador listo para revisar.");
      router.push(`/facturas/${r.invoice_id}` as never);
    });
  }

  return (
    <Button size="sm" onClick={go} disabled={pending} className="gap-1" variant="success">
      <Receipt className="h-3 w-3" /> {pending ? "..." : "Facturar"}
    </Button>
  );
}
