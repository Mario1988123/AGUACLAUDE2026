"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { removeCustomerEquipmentSafeAction } from "./equipment-actions";

/**
 * Botón "Dar de baja" para un equipo de la ficha del cliente. Pensado para
 * equipos EXTERNOS (no nuestros): el cliente se queda la máquina y nosotros
 * solo quitamos nuestro registro, sin pasar por almacén/stock. Baja blanda
 * (queda en histórico). Confirmación en dos pasos para evitar clics sueltos.
 */
export function RemoveEquipmentButton({
  equipmentId,
  customerId,
  equipmentName,
}: {
  equipmentId: string;
  customerId: string;
  equipmentName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function doRemove() {
    startTransition(async () => {
      const r = await removeCustomerEquipmentSafeAction(equipmentId, customerId);
      if (!r.ok) {
        notify.error("No se pudo dar de baja", r.error);
        return;
      }
      notify.success(
        "Equipo dado de baja",
        `"${equipmentName}" deja de aparecer en los equipos activos. El cliente se queda la máquina.`,
      );
      setConfirming(false);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">¿Dar de baja?</span>
        <Button
          variant="destructive"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={doRemove}
          disabled={pending}
        >
          {pending ? "…" : "Sí, dar de baja"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          No
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Dar de baja
    </Button>
  );
}
