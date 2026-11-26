"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/shared/ui/switch";
import { notify } from "@/shared/hooks/use-toast";
import { setAvisosStockSafeAction } from "./actions";

/** Interruptor «Avisos de stock» de Configuración → Notificaciones. */
export function AvisosStockSwitch({ activoInicial }: { activoInicial: boolean }) {
  const [activo, setActivo] = useState(activoInicial);
  const [pending, startTransition] = useTransition();

  function cambiar(valor: boolean) {
    const anterior = activo;
    setActivo(valor);
    startTransition(async () => {
      const r = await setAvisosStockSafeAction(valor);
      if (!r.ok) {
        setActivo(anterior);
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success(valor ? "Avisos de stock encendidos" : "Avisos de stock apagados");
    });
  }

  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">Avisos de stock</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Stock bajo, alertas inteligentes de stock, sugerencias de pedido y
          falta de stock al programar una instalación. Apágalo si todavía no
          lleváis el stock en la app.
        </span>
        {!activo && (
          <span className="mt-1 block text-xs font-medium text-amber-700">
            Apagados: no se crean estos avisos ni se envía push, y el panel no
            enseña la tarjeta de stock.
          </span>
        )}
      </span>
      <Switch
        checked={activo}
        disabled={pending}
        onCheckedChange={cambiar}
        aria-label="Avisos de stock"
        className="mt-0.5"
      />
    </label>
  );
}
