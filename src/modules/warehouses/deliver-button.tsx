"use client";

import { useTransition } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { deliverLoadingRequestAction } from "./loading-request-actions";

export function DeliverLoadingRequestButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="success"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await deliverLoadingRequestAction(id);
            notify.success("Carga entregada");
            location.reload();
          } catch (err) {
            notify.error("Error", err instanceof Error ? err.message : String(err));
          }
        })
      }
    >
      <Truck className="h-3 w-3" /> {pending ? "..." : "Entregar"}
    </Button>
  );
}
