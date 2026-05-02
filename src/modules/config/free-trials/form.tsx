"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateFreeTrialsConfig, type FreeTrialsConfig } from "./actions";

export function FreeTrialsConfigForm({ initial }: { initial: FreeTrialsConfig }) {
  const [days, setDays] = useState(initial.duration_days);
  const [text, setText] = useState(initial.conditions_text);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateFreeTrialsConfig({ duration_days: days, conditions_text: text });
        notify.success("Guardado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="days">Duración por defecto (días)</Label>
        <Input
          id="days"
          type="number"
          min={1}
          max={180}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="max-w-[160px]"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="text">Condiciones legales (texto)</Label>
        <textarea
          id="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-border bg-card p-3 text-sm"
          placeholder="Aparecerán en el albarán de entrega de la prueba gratuita..."
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
