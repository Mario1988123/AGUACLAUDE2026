"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateLeadsConfigSafeAction, type LeadsConfig } from "./actions";

export function LeadsConfigForm({ initial }: { initial: LeadsConfig }) {
  const [staleDays, setStaleDays] = useState(initial.stale_days);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateLeadsConfigSafeAction({ stale_days: staleDays });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Configuración guardada");
    });
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="stale">Días sin actividad antes de avisar</Label>
        <Input
          id="stale"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={staleDays}
          disabled={!initial.editable || pending}
          onChange={(e) => setStaleDays(Number(e.target.value))}
          className="h-11 sm:max-w-[10rem]"
        />
        <p className="text-xs text-muted-foreground">
          Por defecto, 40 días. Cuenta como actividad cualquier movimiento del
          lead: contacto registrado, cambios, citas en agenda o una prueba
          gratuita abierta.
        </p>
        {!initial.editable && (
          <p className="text-xs font-medium text-amber-800">
            Este ajuste se podrá cambiar en cuanto se aplique una actualización
            pendiente de la base de datos. Mientras tanto se avisa a los 40 días.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        El lead <strong>no se le quita a nadie</strong>: pasado ese plazo se avisa
        al comercial (como mucho una vez por semana y lead) y el admin recibe
        un resumen semanal con los leads parados y los que están en la bolsa
        sin repartir. Repartir la bolsa es cosa del admin.
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !initial.editable} className="min-h-11">
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
