"use client";

import { useState, useTransition } from "react";
import { Gift } from "lucide-react";
import { Switch } from "@/shared/ui/switch";
import { notify } from "@/shared/hooks/use-toast";
import { cambiarDisponiblePruebaSafeAction } from "./prueba-gratuita-actions";

/**
 * «Disponible en prueba gratuita»: un clic en la ficha del producto, sin
 * entrar en Editar. Solo lo pinta la ficha cuando el usuario es admin.
 */
export function InterruptorPruebaGratuitaCliente({
  productId,
  inicial,
}: {
  productId: string;
  inicial: boolean;
}) {
  const [activo, setActivo] = useState(inicial);
  const [pending, startTransition] = useTransition();

  function cambiar(valor: boolean) {
    setActivo(valor); // optimista: se deshace si falla
    startTransition(async () => {
      const r = await cambiarDisponiblePruebaSafeAction(productId, valor);
      if (!r.ok) {
        setActivo(!valor);
        notify.error("No se pudo cambiar", r.error);
        return;
      }
      notify.success(
        valor ? "Disponible en prueba gratuita" : "Ya no sale en prueba gratuita",
      );
    });
  }

  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Gift className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Disponible en prueba gratuita</span>
          <span className="block text-xs text-muted-foreground">
            {activo
              ? "Se puede elegir al crear una prueba."
              : "No sale en el selector de la prueba."}
          </span>
        </span>
      </span>
      {/* data-inline: la fila entera ya es la zona de toque de 44 px; sin
          esto la regla global estira el interruptor a 44 px de alto. */}
      <Switch
        data-inline
        checked={activo}
        onCheckedChange={cambiar}
        disabled={pending}
        aria-label="Disponible en prueba gratuita"
      />
    </label>
  );
}
