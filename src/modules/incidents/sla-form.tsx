"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { updateSlaSettingsAction } from "./sla-actions";
import type { SlaSettings } from "./sla-types";

const ROWS: Array<{
  key: keyof SlaSettings;
  label: string;
  badgeVariant: "destructive" | "warning" | "secondary" | "outline";
  hint: string;
}> = [
  {
    key: "critical",
    label: "Critical",
    badgeVariant: "destructive",
    hint: "Sin agua, riesgo eléctrico, fuga grande",
  },
  {
    key: "high",
    label: "High",
    badgeVariant: "warning",
    hint: "Equipo no funciona, sin filtración",
  },
  {
    key: "medium",
    label: "Medium",
    badgeVariant: "secondary",
    hint: "Sabor extraño, baja presión",
  },
  {
    key: "low",
    label: "Low",
    badgeVariant: "outline",
    hint: "Consulta, mantenimiento opcional",
  },
];

export function SlaSettingsForm({ initial }: { initial: SlaSettings }) {
  const [v, setV] = useState(initial);
  const [pending, startTransition] = useTransition();

  function set(key: keyof SlaSettings, val: number) {
    setV((x) => ({ ...x, [key]: val }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateSlaSettingsAction(v);
        notify.success("SLA guardado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Tiempo máximo desde la creación hasta la resolución, por prioridad. Si
        una incidencia supera el SLA, se notifica al director técnico (escalado).
        Las incidencias creadas antes del cambio mantienen su deadline original.
      </p>
      {ROWS.map((row) => (
        <div
          key={row.key}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
        >
          <div className="flex items-center gap-2">
            <Badge variant={row.badgeVariant}>{row.label.toUpperCase()}</Badge>
            <div>
              <div className="text-sm font-bold">{row.label}</div>
              <div className="text-[11px] text-muted-foreground">{row.hint}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Horas</Label>
            <Input
              type="number"
              min={1}
              max={8760}
              value={v[row.key]}
              onChange={(e) => set(row.key, Number(e.target.value))}
              className="w-24"
            />
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar SLA"}
        </Button>
      </div>
    </div>
  );
}
