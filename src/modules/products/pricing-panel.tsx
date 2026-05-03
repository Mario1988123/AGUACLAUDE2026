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

const RENTING_DURATIONS = [12, 24, 36, 48, 60] as const;

export function PricingPlansPanel({ productId, plans }: Props) {
  const [adding, setAdding] = useState<null | "cash" | "renting" | "rental">(null);
  const [rentingDuration, setRentingDuration] = useState<number | null>(null);

  const existingRentingDurations = new Set(
    plans.filter((p) => p.plan_type === "renting").map((p) => p.duration_months),
  );
  const hasCash = plans.some((p) => p.plan_type === "cash");
  const hasRental = plans.some((p) => p.plan_type === "rental");

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
          fixedDuration={adding === "renting" ? rentingDuration : null}
          onDone={() => {
            setAdding(null);
            setRentingDuration(null);
          }}
        />
      )}

      {!adding && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!hasCash && (
              <Button variant="outline" size="sm" onClick={() => setAdding("cash")}>
                <Plus className="h-4 w-4" /> Contado
              </Button>
            )}
            {!hasRental && (
              <Button variant="outline" size="sm" onClick={() => setAdding("rental")}>
                <Plus className="h-4 w-4" /> Alquiler
              </Button>
            )}
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Renting · selecciona duración
            </div>
            <div className="flex flex-wrap gap-2">
              {RENTING_DURATIONS.map((m) => {
                const exists = existingRentingDurations.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (exists) return;
                      setRentingDuration(m);
                      setAdding("renting");
                    }}
                    disabled={exists}
                    className={`inline-flex h-10 items-center justify-center rounded-xl border-2 px-3 text-sm font-bold transition-colors ${
                      exists
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 cursor-default"
                        : "border-border bg-card text-foreground hover:border-primary hover:bg-primary/10"
                    }`}
                  >
                    {m}m{exists && " ✓"}
                  </button>
                );
              })}
            </div>
          </div>
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
  fixedDuration,
  onDone,
}: {
  productId: string;
  planType: "cash" | "renting" | "rental";
  fixedDuration?: number | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    duration_months: planType === "cash" ? "" : String(fixedDuration ?? 12),
    monthly_euros: "",
    total_euros: "",
    /** % comisión que retiene la financiera del total cliente (0-100). */
    financier_fee_percent: planType === "renting" ? "5" : "",
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
      setForm((f) => ({ ...f, total_euros: total }));
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
    const feePercent = form.financier_fee_percent ? Number(form.financier_fee_percent) : null;
    // En renting, la financiera anticipa al proveedor el TOTAL menos su comisión.
    // Nunca puede ser MAYOR que lo que el cliente acabará pagando.
    const financier =
      planType === "renting" && total
        ? Math.round(total * (1 - (feePercent ?? 0) / 100))
        : null;

    startTransition(async () => {
      try {
        await upsertPricingPlanAction({
          product_id: productId,
          plan_type: planType,
          duration_months: planType === "cash" ? null : monthsVal,
          monthly_price_cents: planType === "cash" ? null : monthly,
          total_price_cents: total,
          financing_coefficient:
            planType === "renting" && feePercent != null ? feePercent / 100 : null,
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
              readOnly={planType === "renting" && fixedDuration != null}
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
              <Label>% comisión financiera</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.financier_fee_percent}
                onChange={(e) =>
                  setForm({ ...form, financier_fee_percent: e.target.value })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                % que retiene la financiera. Por defecto 5%.
              </p>
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
