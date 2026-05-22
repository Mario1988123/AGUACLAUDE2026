"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  updateFreeTrialsConfigSafeAction,
  type FreeTrialsConfig,
} from "./actions";

const DEFAULT_TEMPLATE_HINT = `CONDICIONES DE ENTREGA DE EQUIPO EN PRUEBA

1. {empresa} entrega a {cliente} el equipo {equipo}…`;

const PLACEHOLDERS = [
  { token: "{cliente}", help: "Razón social o nombre del cliente" },
  { token: "{empresa}", help: "Nombre comercial de tu empresa" },
  { token: "{equipo}", help: "Modelo + nº serie del equipo" },
  { token: "{direccion}", help: "Dirección de instalación" },
  { token: "{dias_prueba}", help: "Duración acordada en días" },
  { token: "{fecha_entrega}", help: "Fecha en que se firma el albarán" },
  { token: "{fecha_devolucion}", help: "Fecha tope si no se acepta" },
  { token: "{precio_renting_mes}", help: "Cuota orientativa mensual" },
  { token: "{duracion_renting}", help: "Meses de la cuota orientativa" },
];

export function FreeTrialsConfigForm({ initial }: { initial: FreeTrialsConfig }) {
  const [days, setDays] = useState(initial.duration_days);
  const [rentingMonths, setRentingMonths] = useState(
    initial.default_renting_quote_months,
  );
  const [text, setText] = useState(initial.conditions_text);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateFreeTrialsConfigSafeAction({
        duration_days: days,
        conditions_text: text,
        default_renting_quote_months: rentingMonths,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardado");
    });
  }

  function restoreDefault() {
    if (!confirm("¿Restaurar la plantilla por defecto? Perderás los cambios actuales.")) return;
    // Devolvemos texto vacío al servidor → el getter rellena con la plantilla.
    setText("");
    notify.info(
      "Plantilla restaurada",
      "Guarda para confirmar el cambio.",
    );
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="days">Duración por defecto (días)</Label>
          <Input
            id="days"
            type="number"
            min={1}
            max={180}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Default sugerido: 30 días.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rmonths">
            Cuota orientativa renting — duración (meses)
          </Label>
          <Input
            id="rmonths"
            type="number"
            min={1}
            max={120}
            value={rentingMonths}
            onChange={(e) => setRentingMonths(Number(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Sustituye {`{duracion_renting}`} en la plantilla.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label htmlFor="text">Condiciones del albarán de entrega</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={restoreDefault}
          >
            Restaurar plantilla por defecto
          </Button>
        </div>
        <textarea
          id="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="w-full rounded-xl border border-border bg-card p-3 text-sm font-mono"
          placeholder={DEFAULT_TEMPLATE_HINT}
        />
        <details className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
          <summary className="cursor-pointer font-bold">
            🛈 Placeholders disponibles
          </summary>
          <ul className="mt-2 space-y-1">
            {PLACEHOLDERS.map((p) => (
              <li key={p.token}>
                <code className="rounded bg-background px-1.5 py-0.5">
                  {p.token}
                </code>{" "}
                — {p.help}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
