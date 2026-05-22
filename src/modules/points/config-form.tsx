"use client";

import { useState, useTransition } from "react";
import { Save, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updatePointsSettingsSafeAction } from "./config-actions";
import type { PointsSettings } from "./settings";

export function PointsConfigForm({ initial }: { initial: PointsSettings }) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(initial);

  function set<K extends keyof PointsSettings>(key: K, val: PointsSettings[K]) {
    setV((x) => ({ ...x, [key]: val }));
  }

  function save() {
    startTransition(async () => {
      const r = await updatePointsSettingsSafeAction(v);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Configuración guardada");
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
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary">
          Comisiones (€)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Conversión: € por punto</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={v.euros_per_point}
              onChange={(e) => set("euros_per_point", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Cálculo informativo. 0 desactiva el desglose en €. Ej: 0,10 € → 100 puntos = 10 €.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Cierre del ciclo de comisiones</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={String(v.cycle_close_day)}
              onChange={(e) => set("cycle_close_day", Number(e.target.value))}
            >
              <option value="0">Fin de mes natural (1 → 30/31)</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  Día {d} (cada día {d} → día {d === 1 ? 28 : d - 1})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Define cuándo se cierra el ciclo y se totalizan puntos para llevar a nómina.
              Las empresas con nómina mes vencido suelen usar &laquo;Fin de mes&raquo;; las que pagan a mes vencido
              desde el día X (típicamente 25) usan ese día.
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

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary">
            Hitos / bonus mensuales
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setV((x) => ({
                ...x,
                monthly_milestones: [
                  ...(x.monthly_milestones ?? []),
                  { threshold: 100, bonus_points: 25, label: "Nuevo hito" },
                ],
              }))
            }
          >
            <Plus className="h-4 w-4" /> Añadir hito
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Solo se otorgan al alcanzar el 100% del umbral en el mes en curso.
        </p>
        {(v.monthly_milestones ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin hitos configurados.</p>
        ) : (
          <div className="space-y-2">
            {(v.monthly_milestones ?? []).map((m, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-end gap-2 rounded-xl border bg-background p-3"
              >
                <div className="col-span-5 space-y-1">
                  <Label className="text-xs">Etiqueta</Label>
                  <Input
                    value={m.label}
                    onChange={(e) => {
                      const next = [...(v.monthly_milestones ?? [])];
                      next[idx] = { ...m, label: e.target.value };
                      set("monthly_milestones", next);
                    }}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Umbral (puntos)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={m.threshold}
                    onChange={(e) => {
                      const next = [...(v.monthly_milestones ?? [])];
                      next[idx] = { ...m, threshold: Number(e.target.value) };
                      set("monthly_milestones", next);
                    }}
                  />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Bonus</Label>
                  <Input
                    type="number"
                    min={0}
                    value={m.bonus_points}
                    onChange={(e) => {
                      const next = [...(v.monthly_milestones ?? [])];
                      next[idx] = { ...m, bonus_points: Number(e.target.value) };
                      set("monthly_milestones", next);
                    }}
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = (v.monthly_milestones ?? []).filter((_, i) => i !== idx);
                      set("monthly_milestones", next);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} variant="success" size="lg">
          <Save className="h-5 w-5" /> {pending ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    </div>
  );
}
