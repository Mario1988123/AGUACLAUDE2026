"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveSavingsConfigSafeAction } from "./actions";
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
    plan_cash: initial.enabled_plans?.cash ?? true,
    plan_rental: initial.enabled_plans?.rental ?? true,
    plan_renting: initial.enabled_plans?.renting ?? true,
    default_renting_duration: String(initial.default_renting_duration_months ?? 48),
    default_rental_permanence: String(initial.default_rental_permanence_months ?? 24),
  });

  function save() {
    if (!form.plan_cash && !form.plan_rental && !form.plan_renting) {
      notify.warning("Habilita al menos un plan");
      return;
    }
    startTransition(async () => {
      const r = await saveSavingsConfigSafeAction({
        osmosis_annual_cost_cents: Math.round(Number(form.osmosis_eur.replace(",", ".")) * 100),
        liters_per_person_day_home: Number(form.liters_home.replace(",", ".")),
        liters_per_person_day_office: Number(form.liters_office.replace(",", ".")),
        co2_per_bottle_kg: Number(form.co2),
        plastic_per_bottle_kg: Number(form.plastic),
        default_bottle_size_liters: Number(form.bottle),
        service_garrafa_size_liters: Number(form.garrafa),
        service_cycles_per_year: Number(form.cycles),
        recommended_dispensers_threshold: Number(form.threshold),
        enabled_plans: {
          cash: form.plan_cash,
          rental: form.plan_rental,
          renting: form.plan_renting,
        },
        default_renting_duration_months: Number(form.default_renting_duration) || 48,
        default_rental_permanence_months: Number(form.default_rental_permanence) || 24,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardado");
      router.refresh();
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

      <div className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Planes ofrecidos en la calculadora
        </h3>
        <p className="text-xs text-muted-foreground">
          Marca qué planes verá el comercial al usar el wizard.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { key: "plan_cash" as const, label: "Compra (contado)" },
            { key: "plan_rental" as const, label: "Alquiler" },
            { key: "plan_renting" as const, label: "Renting" },
          ].map((p) => (
            <label
              key={p.key}
              className={`flex items-center gap-2 rounded-xl border-2 p-3 cursor-pointer ${
                form[p.key]
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <input
                type="checkbox"
                checked={form[p.key]}
                onChange={(e) => setForm({ ...form, [p.key]: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm font-bold">{p.label}</span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <Field label="Duración renting por defecto (meses)" hint="Sale preseleccionada al elegir Renting">
            <select
              value={form.default_renting_duration}
              onChange={(e) => setForm({ ...form, default_renting_duration: e.target.value })}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {[12, 24, 36, 48, 60].map((m) => (
                <option key={m} value={m}>
                  {m} meses
                </option>
              ))}
            </select>
          </Field>
          <Field label="Permanencia alquiler por defecto (meses)">
            <Input
              type="number"
              value={form.default_rental_permanence}
              onChange={(e) => setForm({ ...form, default_rental_permanence: e.target.value })}
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
