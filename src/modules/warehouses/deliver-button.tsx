"use client";

import { useTransition } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { deliverLoadingRequestSafeAction } from "./loading-request-actions";

export function DeliverLoadingRequestButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="success"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await deliverLoadingRequestSafeAction(id);
          if (!r.ok) {
            notify.error("Error", r.error);
            return;
          }
          notify.success("Carga entregada");
          location.reload();
        })
      }
    >
      <Truck className="h-3 w-3" /> {pending ? "..." : "Entregar"}
    </Button>
  );
}
