"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveSavingsConfigAction } from "./actions";
import type { CalcConfig } from "./calc";

export function SavingsConfigForm({ initial }: { initial: CalcConfig }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    osmosis_eur: (initial.osmosis_annual_cost_cents / 100).toFixed(2),
    liters_home: initial.liters_per_person_day_home.toFixed(2),
    liters_office: initial.liters_per_person_day_office.toFixed(2),
    co2: initial.co2_per_bottle_kg.toString(),
    plastic: initial.plastic_per_bottle_kg.toString(),
    bottle: initial.default_bottle_size_liters.toString(),
    garrafa: initial.service_garrafa_size_liters.toString(),
    cycles: initial.service_cycles_per_year.toString(),
    threshold: initial.recommended_dispensers_threshold.toString(),
  });

  function save() {
    startTransition(async () => {
      try {
        await saveSavingsConfigAction({
          osmosis_annual_cost_cents: Math.round(Number(form.osmosis_eur.replace(",", ".")) * 100),
          liters_per_person_day_home: Number(form.liters_home.replace(",", ".")),
          liters_per_person_day_office: Number(form.liters_office.replace(",", ".")),
          co2_per_bottle_kg: Number(form.co2),
          plastic_per_bottle_kg: Number(form.plastic),
          default_bottle_size_liters: Number(form.bottle),
          service_garrafa_size_liters: Number(form.garrafa),
          service_cycles_per_year: Number(form.cycles),
          recommended_dispensers_threshold: Number(form.threshold),
        });
        notify.success("Guardado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Coste anual ósmosis del cliente (€)" hint="Si el cliente ya tiene ósmosis instalada">
          <Input
            type="number"
            step="0.01"
            value={form.osmosis_eur}
            onChange={(e) => setForm({ ...form, osmosis_eur: e.target.value })}
          />
        </Field>
        <Field label="Umbral dispensadores empresa" hint="Si > N personas → 2 dispensadores recomendados">
          <Input
            type="number"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
          />
        </Field>
        <Field label="Litros/persona/día — Hogar">
          <Input
            type="number"
            step="0.1"
            value={form.liters_home}
            onChange={(e) => setForm({ ...form, liters_home: e.target.value })}
          />
        </Field>
        <Field label="Litros/persona/día — Oficina">
          <Input
            type="number"
            step="0.1"
            value={form.liters_office}
            onChange={(e) => setForm({ ...form, liters_office: e.target.value })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Impacto ecológico (por botella 1.5 L)
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="CO₂ (kg)">
            <Input
              type="number"
              step="0.001"
              value={form.co2}
              onChange={(e) => setForm({ ...form, co2: e.target.value })}
            />
          </Field>
          <Field label="Plástico (kg)">
            <Input
              type="number"
              step="0.001"
              value={form.plastic}
              onChange={(e) => setForm({ ...form, plastic: e.target.value })}
            />
          </Field>
          <Field label="Tamaño botella (L)">
            <Input
              type="number"
              step="0.1"
              value={form.bottle}
              onChange={(e) => setForm({ ...form, bottle: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Servicio garrafas (Aquaservice, Culligan…)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tamaño garrafa (L)">
            <Input
              type="number"
              step="0.5"
              value={form.garrafa}
              onChange={(e) => setForm({ ...form, garrafa: e.target.value })}
            />
          </Field>
          <Field label="Ciclos al año" hint="Reposiciones/año (13 = ~mensual con bisiesto)">
            <Input
              type="number"
              value={form.cycles}
              onChange={(e) => setForm({ ...form, cycles: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <Button onClick={save} disabled={pending} variant="success">
        {pending ? "Guardando…" : "Guardar parámetros"}
      </Button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
