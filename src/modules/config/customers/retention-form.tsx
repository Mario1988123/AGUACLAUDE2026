"use client";

import { useState, useTransition } from "react";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { updateCustomerRetentionDaysSafeAction } from "@/modules/config/company/actions";

/**
 * Ajuste "duración de cliente para el comercial": número de días que un
 * comercial (nivel 3) sigue viendo a un cliente tras venderle. 0 = desactivado.
 */
export function CustomerRetentionForm({ initial }: { initial: number }) {
  const [days, setDays] = useState<string>(String(initial ?? 0));
  const [pending, startTransition] = useTransition();

  function save() {
    const n = Math.max(0, Math.min(3650, Math.round(Number(days) || 0)));
    startTransition(async () => {
      const r = await updateCustomerRetentionDaysSafeAction(n);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      setDays(String(n));
      notify.success(
        n === 0
          ? "Desactivado: el comercial solo verá sus clientes asignados"
          : `Guardado: el comercial verá a sus clientes ${n} días tras la venta`,
      );
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Días
        </label>
        <Input
          type="text"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
          className="w-28"
          placeholder="0"
        />
      </div>
      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        <strong>0 = desactivado</strong> (el comercial solo ve sus clientes
        asignados). Un número mayor = sigue viéndolos esos días tras la venta
        para recontactar y ofrecer más productos.
      </p>
    </div>
  );
}
