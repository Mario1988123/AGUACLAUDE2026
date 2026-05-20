"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadsConfigSafeAction, type LeadsConfig } from "./actions";

export function LeadsConfigForm({ initial }: { initial: LeadsConfig }) {
  const [tmkDays, setTmkDays] = useState(initial.expiry_days_tmk);
  const [commercialDays, setCommercialDays] = useState(initial.expiry_days_commercial);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateLeadsConfigSafeAction({
        expiry_days_tmk: tmkDays,
        expiry_days_commercial: commercialDays,
        expiry_days: commercialDays, // legacy fallback
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Configuración guardada");
    });
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tmk">Leads de TMK (días)</Label>
          <Input
            id="tmk"
            type="number"
            min={1}
            max={365}
            value={tmkDays}
            onChange={(e) => setTmkDays(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Default: 15 días. Pasados estos días sin acción, el lead se
            desasigna y queda visible para nivel 1/2.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comm">Leads creados por comercial (días)</Label>
          <Input
            id="comm"
            type="number"
            min={1}
            max={365}
            value={commercialDays}
            onChange={(e) => setCommercialDays(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Default: 30 días. Aplica a leads con cualquier origen distinto
            de TMK.
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        ⚠ Al caducar: el lead se marca como <strong>caducado</strong>, se
        <strong> desasigna del comercial</strong>, queda en el evento del
        timeline el comercial anterior y se notifica a admin / dirección
        comercial / dirección TMK / dirección técnica para que reasignen.
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
