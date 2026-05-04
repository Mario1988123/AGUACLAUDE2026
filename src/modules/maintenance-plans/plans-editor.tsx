"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Sparkles, Wrench, Save, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { MoneyInput } from "@/shared/components/money-input";
import {
  updateMaintenancePlanAction,
  reseedDefaultPlansAction,
} from "./config-actions";
import type { MaintenancePlan } from "./actions";

const TIER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  lite: Wrench,
  medium: Sparkles,
  premium: Crown,
};

const TIER_LABEL: Record<string, string> = {
  lite: "Lite",
  medium: "Medium",
  premium: "Premium",
};

export function MaintenancePlansEditor({
  plans,
}: {
  plans: MaintenancePlan[];
}) {
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();
  const router = useRouter();

  function reseed() {
    startTransition(async () => {
      const ok = await ask({
        title: "Restaurar planes por defecto",
        message:
          "Volverá a los valores Lite (10€) / Medium (15€) / Premium (20€). Las personalizaciones que hayas hecho se sobrescriben. Los contratos firmados NO se ven afectados.",
        confirmText: "Restaurar",
        variant: "warning",
      });
      if (!ok) return;
      try {
        await reseedDefaultPlansAction();
        notify.success("Planes restaurados");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (plans.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Sin planes definidos. Pulsa abajo para crear los 3 por defecto.
        </div>
        <Button onClick={reseed} disabled={pending} className="w-full">
          <RefreshCw className="h-4 w-4" /> Crear planes por defecto
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {plans.map((p) => (
        <PlanRow key={p.id} plan={p} />
      ))}
      <div className="flex justify-end">
        <Button
          onClick={reseed}
          disabled={pending}
          variant="outline"
          size="sm"
        >
          <RefreshCw className="h-3 w-3" /> Restaurar defaults
        </Button>
      </div>
    </div>
  );
}

function PlanRow({ plan }: { plan: MaintenancePlan }) {
  const Icon = TIER_ICON[plan.tier] ?? Wrench;
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    name: plan.name,
    monthly_cents: plan.monthly_cents,
    visits_per_year: plan.visits_per_year,
    visits_unlimited: plan.visits_per_year == null,
    parts_discount_percent: plan.parts_discount_percent,
    spare_equipment_included: plan.spare_equipment_included,
    description: plan.description ?? "",
    is_active: plan.is_active,
  });

  function save() {
    startTransition(async () => {
      try {
        await updateMaintenancePlanAction(plan.id, {
          name: form.name,
          monthly_cents: form.monthly_cents,
          visits_per_year: form.visits_unlimited ? null : form.visits_per_year ?? 0,
          parts_discount_percent: form.parts_discount_percent,
          spare_equipment_included: form.spare_equipment_included,
          description: form.description || null,
          is_active: form.is_active,
        });
        notify.success("Plan guardado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div
      className={`rounded-2xl border-2 p-4 ${
        form.is_active ? "border-border bg-card" : "border-dashed border-border bg-muted/30"
      }`}
    >
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <Icon className="h-5 w-5 text-primary" />
        <h3 className="text-base font-extrabold">{TIER_LABEL[plan.tier]}</h3>
        <Badge variant={form.is_active ? "success" : "secondary"}>
          {form.is_active ? "Activo" : "Inactivo"}
        </Badge>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Activo
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Nombre comercial</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Cuota mensual</Label>
          <MoneyInput
            valueCents={form.monthly_cents}
            onChangeCents={(c) => setForm({ ...form, monthly_cents: c })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Visitas/año</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={form.visits_per_year ?? 0}
              disabled={form.visits_unlimited}
              onChange={(e) =>
                setForm({ ...form, visits_per_year: parseInt(e.target.value) || 0 })
              }
            />
            <label className="flex shrink-0 items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={form.visits_unlimited}
                onChange={(e) =>
                  setForm({ ...form, visits_unlimited: e.target.checked })
                }
              />
              ∞
            </label>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>% descuento piezas</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={form.parts_discount_percent}
            onChange={(e) =>
              setForm({
                ...form,
                parts_discount_percent: parseInt(e.target.value) || 0,
              })
            }
          />
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.spare_equipment_included}
          onChange={(e) =>
            setForm({ ...form, spare_equipment_included: e.target.checked })
          }
        />
        Equipo de recambio incluido
      </label>

      <div className="mt-3 space-y-1.5">
        <Label>Descripción</Label>
        <textarea
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded-xl border border-input bg-background p-2 text-sm"
        />
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-3 w-3" /> {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
