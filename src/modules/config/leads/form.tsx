"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadsConfigAction, type LeadsConfig } from "./actions";

export function LeadsConfigForm({ initial }: { initial: LeadsConfig }) {
  const [days, setDays] = useState(initial.expiry_days);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateLeadsConfigAction({ expiry_days: days });
        notify.success("Configuración guardada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="days">Días máx. sin acción antes de marcar como caducado</Label>
        <Input
          id="days"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="max-w-[160px]"
        />
        <p className="text-xs text-muted-foreground">
          Si un lead lleva más de este número de días sin contacto ni cambio de estado, queda
          marcado como caducado y nivel 2 puede reasignarlo o enviarlo a ventas perdidas.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
