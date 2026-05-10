"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { convertLeadToCustomerAction } from "./actions";

export function ConvertLeadButton({ leadId, alreadyConverted }: { leadId: string; alreadyConverted: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  if (alreadyConverted) return null;

  async function convert() {
    const ok = await ask({
      message: "¿Convertir este lead en cliente? Sus direcciones se moverán al cliente.",
      confirmText: "Convertir",
      variant: "success",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const customerId = await convertLeadToCustomerAction(leadId);
        notify.success("Convertido a cliente");
        router.push(`/clientes/${customerId}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button onClick={convert} disabled={pending} size="sm" variant="success">
      <ArrowRight className="h-4 w-4" />
      {pending ? "Convirtiendo..." : "Cliente"}
    </Button>
  );
}
