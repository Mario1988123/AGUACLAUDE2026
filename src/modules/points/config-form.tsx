"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updatePointsSettingsAction } from "./config-actions";
import type { PointsSettings } from "./settings";

export function PointsConfigForm({ initial }: { initial: PointsSettings }) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(initial);

  function set<K extends keyof PointsSettings>(key: K, val: PointsSettings[K]) {
    setV((x) => ({ ...x, [key]: val }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updatePointsSettingsAction(v);
        notify.success("Configuración guardada");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary">
          Telemarketing
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Puntos por lead captado</Label>
            <Input
              type="number"
              min={0}
              value={v.points_lead_captured}
              onChange={(e) => set("points_lead_captured", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Se otorga al telemarketer al crear el lead.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>% del split en venta del lead que captó</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={v.tmk_split_percent}
              onChange={(e) => set("tmk_split_percent", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Cuando un comercial cierra la venta de un lead originado por TMK, el telemarketer
              recibe este % de los puntos. El resto se lo lleva el comercial.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Comercial</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Puntos por equipo vendido</Label>
            <Input
              type="number"
              min={0}
              value={v.points_per_equipment_sold}
              onChange={(e) => set("points_per_equipment_sold", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Multiplica por la cantidad de items en el contrato.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>% de penalización si vende bajo mínimo autorizado</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={v.discount_penalty_percent}
              onChange={(e) => set("discount_penalty_percent", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Si la venta queda por debajo del precio mínimo comercial autorizado del producto,
              se reducen los puntos en este %.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary">Técnico</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Puntos por instalación completada</Label>
            <Input
              type="number"
              min={0}
              value={v.points_per_installation}
              onChange={(e) => set("points_per_installation", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Puntos por mantenimiento completado</Label>
            <Input
              type="number"
              min={0}
              value={v.points_per_maintenance}
              onChange={(e) => set("points_per_maintenance", Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Puntos por incidencia resuelta</Label>
            <Input
              type="number"
              min={0}
              value={v.points_per_incident}
              onChange={(e) => set("points_per_incident", Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success" size="lg">
          <Save className="h-5 w-5" /> {pending ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
