"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { collectContractPaymentAction } from "./actions";

export function QuickCollectButton({
  paymentId,
  status,
}: {
  paymentId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (status !== "pending") return null;

  function collect() {
    startTransition(async () => {
      try {
        await collectContractPaymentAction(paymentId);
        notify.success("Cobrado · pendiente de validar");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={collect} disabled={pending}>
      <Coins className="h-3 w-3" /> Cobrar
    </Button>
  );
}
