"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { deleteProductAction } from "./actions";

/**
 * Botón de BORRAR producto (solo admin). Solo borra de verdad si el producto
 * no tiene historial; si lo tiene, avisa de que se desactive.
 */
export function DeleteProductButton({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  // REGLA: solo se borra un producto inactivo. Confirmamos FUERA de la
  // transición y la llamada lleva timeout: el botón nunca se queda colgado.
  async function handle() {
    if (isActive) {
      notify.warning(
        "Primero desactívalo",
        "Solo se pueden borrar productos inactivos. Pulsa «Desactivar» y luego «Borrar».",
      );
      return;
    }
    const ok = await ask({
      message:
        "¿Borrar este producto definitivamente? Solo se puede si NO tiene ningún movimiento (stock, instalaciones, contratos…). Si lo tiene, no se borrará y se queda desactivado.",
      confirmText: "Borrar producto",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await Promise.race([
          deleteProductAction(productId),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 15000),
          ),
        ]);
        if (r.ok) {
          notify.success("Producto borrado");
          router.push("/productos");
          return;
        }
        if (r.reason === "active") {
          notify.warning("Primero desactívalo", r.error);
        } else if (r.reason === "history") {
          notify.warning("No se puede borrar", r.error);
        } else {
          notify.error("Error", r.error);
        }
      } catch {
        notify.error(
          "No se pudo completar el borrado",
          "Tardó demasiado o falló la conexión (posible caché del navegador). Recarga con Ctrl+Shift+R y reinténtalo.",
        );
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handle}
      disabled={pending}
      className="text-destructive hover:bg-destructive/10"
    >
      <Trash2 className="h-4 w-4" /> Borrar
    </Button>
  );
}
