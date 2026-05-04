"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { convertLeadToCustomerAction } from "./actions";

export function ConvertLeadButton({ leadId, alreadyConverted }: { leadId: string; alreadyConverted: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  if (alreadyConverted) {
    return (
      <p className="text-sm text-success">✓ Ya convertido a cliente</p>
    );
  }

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
    <Button onClick={convert} disabled={pending} size="lg" variant="success" className="w-full">
      <UserPlus className="h-5 w-5" />
      {pending ? "Convirtiendo..." : "Convertir a cliente"}
    </Button>
  );
}
