"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertPricingPlanAction,
  deletePricingPlanAction,
  type PricingPlan,
} from "./pricing-actions";

interface Props {
  productId: string;
  plans: PricingPlan[];
}

const PLAN_LABEL = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
} as const;

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function PricingPlansPanel({ productId, plans }: Props) {
  const [adding, setAdding] = useState<null | "cash" | "renting" | "rental">(null);

  return (
    <div className="space-y-4">
      {plans.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin planes de precio. Añade al menos uno para poder ofertar.
        </div>
      )}

      {plans.map((p) => (
        <PlanRow key={p.id} plan={p} productId={productId} />
      ))}

      {adding && (
        <PlanForm
          productId={productId}
          planType={adding}
          onDone={() => setAdding(null)}
        />
      )}

      {!adding && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding("cash")}>
            <Plus className="h-4 w-4" /> Contado
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding("renting")}>
            <Plus className="h-4 w-4" /> Renting
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding("rental")}>
            <Plus className="h-4 w-4" /> Alquiler
          </Button>
        </div>
      )}
    </div>
  );
}

function PlanRow({ plan, productId }: { plan: PricingPlan; productId: string }) {
  const [pending, startTransition] = useTransition();
  function remove() {
    if (!confirm("¿Eliminar este plan?")) return;
    startTransition(async () => {
      try {
        await deletePricingPlanAction(plan.id, productId);
        notify.success("Plan eliminado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="default">{PLAN_LABEL[plan.plan_type]}</Badge>
            {plan.duration_months && (
              <span className="text-sm font-semibold">{plan.duration_months} meses</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {plan.monthly_price_cents != null && (
              <div>
                <span className="text-xs text-muted-foreground">Cuota</span>
                <div className="font-bold">{formatCents(plan.monthly_price_cents)}/mes</div>
              </div>
            )}
            <div>
              <span className="text-xs text-muted-foreground">Total cliente</span>
              <div className="font-bold">{formatCents(plan.total_price_cents)}</div>
            </div>
            {plan.financier_payment_cents != null && (
              <div>
                <span className="text-xs text-muted-foreground">Financiera paga</span>
                <div className="font-bold">{formatCents(plan.financier_payment_cents)}</div>
              </div>
            )}
            <div>
              <span className="text-xs text-muted-foreground">Min. comercial</span>
              <div>{formatCents(plan.min_authorized_cents)}</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Min. absoluto</span>
              <div>{formatCents(plan.absolute_min_cents)}</div>
            </div>
            {plan.permanence_months && (
              <div>
                <span className="text-xs text-muted-foreground">Permanencia</span>
                <div>{plan.permanence_months} meses</div>
              </div>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function PlanForm({
  productId,
  planType,
  onDone,
}: {
  productId: string;
  planType: "cash" | "renting" | "rental";
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    duration_months: planType === "cash" ? "" : "12",
    monthly_euros: "",
    total_euros: "",
    coefficient: planType === "renting" ? "0.02375" : "",
    permanence_months: planType === "rental" ? "12" : "",
    min_authorized_euros: "",
    absolute_min_euros: "",
  });

  function calc() {
    if (planType === "cash") return;
    const months = Number(form.duration_months) || 0;
    const monthly = Number(form.monthly_euros) || 0;
    if (months > 0 && monthly > 0) {
      const total = (months * monthly).toFixed(2);
      const coef = Number(form.coefficient) || 0;
      const financier =
        planType === "renting" && coef > 0 ? (monthly / coef).toFixed(2) : "";
      setForm((f) => ({ ...f, total_euros: total, ...(financier && { financier }) }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const total = Math.round(Number(form.total_euros) * 100);
    const monthly = form.monthly_euros ? Math.round(Number(form.monthly_euros) * 100) : null;
    const minAuth = Math.round(Number(form.min_authorized_euros) * 100);
    const minAbs = Math.round(Number(form.absolute_min_euros) * 100);
    if (!total || total <= 0) {
      notify.warning("Total cliente obligatorio");
      return;
    }
    if (minAbs > minAuth || minAuth > total) {
      notify.warning("Mínimos: absoluto ≤ comercial ≤ total");
      return;
    }
    const monthsVal = form.duration_months ? Number(form.duration_months) : null;
    const coef = form.coefficient ? Number(form.coefficient) : null;
    const financier = monthly && coef ? Math.round((monthly / coef) * 100) : null;

    startTransition(async () => {
      try {
        await upsertPricingPlanAction({
          product_id: productId,
          plan_type: planType,
          duration_months: planType === "cash" ? null : monthsVal,
          monthly_price_cents: planType === "cash" ? null : monthly,
          total_price_cents: total,
          financing_coefficient: planType === "renting" ? coef : null,
          financier_payment_cents: planType === "renting" ? financier : null,
          permanence_months: planType === "rental" ? Number(form.permanence_months) || null : null,
          min_authorized_cents: minAuth,
          absolute_min_cents: minAbs,
        });
        notify.success("Plan guardado");
        onDone();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-4"
    >
      <div className="flex items-center gap-2 text-sm font-bold uppercase">
        <Badge variant="default">{PLAN_LABEL[planType]}</Badge>
        Nuevo plan
      </div>

      {planType !== "cash" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Duración (meses) *</Label>
            <Input
              type="number"
              min={1}
              required
              value={form.duration_months}
              onChange={(e) => setForm({ ...form, duration_months: e.target.value })}
              onBlur={calc}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cuota mensual (€) *</Label>
            <Input
              type="number"
              step="0.01"
              required
              value={form.monthly_euros}
              onChange={(e) => setForm({ ...form, monthly_euros: e.target.value })}
              onBlur={calc}
            />
          </div>
          {planType === "renting" && (
            <div className="space-y-1.5">
              <Label>Coeficiente financiera</Label>
              <Input
                type="number"
                step="0.000001"
                value={form.coefficient}
                onChange={(e) => setForm({ ...form, coefficient: e.target.value })}
                onBlur={calc}
              />
            </div>
          )}
          {planType === "rental" && (
            <div className="space-y-1.5">
              <Label>Permanencia (meses)</Label>
              <Input
                type="number"
                value={form.permanence_months}
                onChange={(e) => setForm({ ...form, permanence_months: e.target.value })}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Total cliente (€) *</Label>
          <Input
            type="number"
            step="0.01"
            required
            value={form.total_euros}
            onChange={(e) => setForm({ ...form, total_euros: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mín. comercial (€) *</Label>
          <Input
            type="number"
            step="0.01"
            required
            value={form.min_authorized_euros}
            onChange={(e) => setForm({ ...form, min_authorized_euros: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mín. absoluto (€) *</Label>
          <Input
            type="number"
            step="0.01"
            required
            value={form.absolute_min_euros}
            onChange={(e) => setForm({ ...form, absolute_min_euros: e.target.value })}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Mínimo comercial = nivel 3 puede vender sin aprobación. Mínimo absoluto = requiere
        aprobación nivel 1/2.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar plan"}
        </Button>
      </div>
    </form>
  );
}
