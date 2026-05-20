"use client";

import { useTransition } from "react";
import { Play } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { startMaintenanceSafeAction } from "./actions";

export function StartMaintenanceButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await startMaintenanceSafeAction(id);
          if (!r.ok) {
            notify.error("No se pudo iniciar", r.error);
            return;
          }
          notify.success("Mantenimiento iniciado");
          location.reload();
        })
      }
    >
      <Play className="h-5 w-5" />
      {pending ? "Iniciando..." : "Iniciar mantenimiento"}
    </Button>
  );
}
