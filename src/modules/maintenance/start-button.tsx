"use client";

import { useTransition } from "react";
import { Play } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { startMaintenanceAction } from "./actions";

export function StartMaintenanceButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await startMaintenanceAction(id);
            notify.success("Mantenimiento iniciado");
            location.reload();
          } catch (err) {
            notify.error("Error", err instanceof Error ? err.message : String(err));
          }
        })
      }
    >
      <Play className="h-5 w-5" />
      {pending ? "Iniciando..." : "Iniciar mantenimiento"}
    </Button>
  );
}
