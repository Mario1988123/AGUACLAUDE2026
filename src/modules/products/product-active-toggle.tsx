"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, PowerOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { setProductActiveAction } from "./actions";

/**
 * Activa / desactiva un producto (solo admin). Desactivar es el paso previo
 * obligatorio para poder borrar (regla: solo se borran productos inactivos).
 */
export function ProductActiveToggle({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  function handle() {
    startTransition(async () => {
      if (isActive) {
        const ok = await ask({
          message:
            "¿Desactivar este producto? Dejará de aparecer en catálogos, calculadora y nuevas ventas. No se pierde nada: podrás reactivarlo cuando quieras (y, si fue un alta por error, borrarlo).",
          confirmText: "Desactivar",
        });
        if (!ok) return;
      }
      const r = await setProductActiveAction(productId, !isActive);
      if (r.ok) {
        notify.success(isActive ? "Producto desactivado" : "Producto activado");
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  return (
    <Button type="button" variant="outline" onClick={handle} disabled={pending}>
      {isActive ? (
        <>
          <PowerOff className="h-4 w-4" /> Desactivar
        </>
      ) : (
        <>
          <Power className="h-4 w-4" /> Activar
        </>
      )}
    </Button>
  );
}
