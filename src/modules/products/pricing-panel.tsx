"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
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

function formatCents(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

const RENTING_DURATIONS = [12, 24, 36, 48, 60] as const;
const RENTAL_DURATIONS = [12, 24, 36, 48, 60] as const;

export function PricingPlansPanel({ productId, plans }: Props) {
  const [adding, setAdding] = useState<null | "cash" | "renting" | "rental">(null);
  const [rentingDuration, setRentingDuration] = useState<number | null>(null);
  const [rentalDuration, setRentalDuration] = useState<number | null>(null);

  const existingRentingDurations = new Set(
    plans.filter((p) => p.plan_type === "renting").map((p) => p.duration_months),
  );
  const existingRentalDurations = new Set(
    plans.filter((p) => p.plan_type === "rental").map((p) => p.permanence_months ?? p.duration_months),
  );
  const hasCash = plans.some((p) => p.plan_type === "cash");

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
          fixedDuration={
            adding === "renting"
              ? rentingDuration
              : adding === "rental"
                ? rentalDuration
                : null
          }
          onDone={() => {
            setAdding(null);
            setRentingDuration(null);
            setRentalDuration(null);
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
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Alquiler · selecciona permanencia (puedes añadir varias)
            </div>
            <div className="flex flex-wrap gap-2">
              {RENTAL_DURATIONS.map((m) => {
                const exists = existingRentalDurations.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (exists) return;
                      setRentalDuration(m);
                      setAdding("rental");
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
            <p className="mt-2 text-[11px] text-muted-foreground">
              La cuota mensual puede cambiar según la permanencia. Crea un plan por cada
              permanencia que quieras ofertar.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Renting · selecciona duración (puedes añadir varias)
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
  const ask = useConfirm();
  async function remove() {
    const ok = await ask({
      message: "¿Eliminar este plan?",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deletePricingPlanAction(plan.id, productId);
        notify.success("Plan eliminado");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  const indivMonthly =
    plan.monthly_price_individual_cents ?? plan.monthly_price_cents;
  const indivTotal = plan.total_price_individual_cents ?? plan.total_price_cents;
  const bizMonthly = plan.monthly_price_business_cents;
  const bizTotal = plan.total_price_business_cents;
  const bizFinancier = plan.financier_payment_business_cents;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="default">{PLAN_LABEL[plan.plan_type]}</Badge>
            {plan.duration_months && (
              <span className="text-sm font-semibold">{plan.duration_months} meses</span>
            )}
            {plan.permanence_months && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                Permanencia: {plan.permanence_months}m
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Particular */}
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                Particular · IVA incluido
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {indivMonthly != null && (
                  <div>
                    <span className="text-xs text-muted-foreground">Cuota</span>
                    <div className="font-bold">{formatCents(indivMonthly)}/mes</div>
                  </div>
                )}
                <div>
                  <span className="text-xs text-muted-foreground">Total</span>
                  <div className="font-bold">{formatCents(indivTotal)}</div>
                </div>
              </div>
            </div>

            {/* Empresa/autónomo */}
            <div
              className={`rounded-lg border p-3 ${
                bizTotal != null
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-dashed border-muted-foreground/30 bg-muted/20"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Empresa / autónomo · BASE (+IVA al facturar)
              </div>
              {bizTotal == null && bizMonthly == null ? (
                <p className="mt-1 text-xs text-muted-foreground italic">
                  Sin precio para empresa todavía.
                </p>
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {bizMonthly != null && (
                    <div>
                      <span className="text-xs text-muted-foreground">Cuota base</span>
                      <div className="font-bold">{formatCents(bizMonthly)}/mes</div>
                    </div>
                  )}
                  {bizTotal != null && (
                    <div>
                      <span className="text-xs text-muted-foreground">Total base</span>
                      <div className="font-bold">{formatCents(bizTotal)}</div>
                    </div>
                  )}
                  {plan.plan_type === "renting" && bizFinancier != null && (
                    <div className="col-span-2">
                      <span className="text-xs text-muted-foreground">
                        Financiera paga (base)
                      </span>
                      <div className="font-bold">{formatCents(bizFinancier)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 border-t pt-2">
            <div>
              <span className="text-muted-foreground">Mín. comercial:</span>{" "}
              <span className="font-semibold">{formatCents(plan.min_authorized_cents)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Mín. absoluto:</span>{" "}
              <span className="font-semibold">{formatCents(plan.absolute_min_cents)}</span>
            </div>
            {plan.financing_coefficient != null && (
              <div>
                <span className="text-muted-foreground">Coef. renting:</span>{" "}
                <span className="font-semibold tabular-nums">
                  {plan.financing_coefficient}
                </span>
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
    // Precios PARTICULAR (IVA incluido)
    monthly_indiv_euros: "",
    total_indiv_euros: "",
    // Precios EMPRESA / AUTÓNOMO (BASE — IVA se añade al facturar)
    monthly_biz_euros: "",
    total_biz_euros: "",
    /** % comisión que retiene la financiera del total empresa (0-100). */
    financier_fee_percent: planType === "renting" ? "5" : "",
    permanence_months: planType === "rental" ? String(fixedDuration ?? 12) : "",
    min_authorized_euros: "",
    absolute_min_euros: "",
  });

  function recalcIndiv() {
    if (planType === "cash") return;
    const months = Number(form.duration_months) || 0;
    const monthly = Number(form.monthly_indiv_euros) || 0;
    if (months > 0 && monthly > 0) {
      setForm((f) => ({ ...f, total_indiv_euros: (months * monthly).toFixed(2) }));
    }
  }
  function recalcBiz() {
    if (planType === "cash") return;
    const months = Number(form.duration_months) || 0;
    const monthly = Number(form.monthly_biz_euros) || 0;
    if (months > 0 && monthly > 0) {
      setForm((f) => ({ ...f, total_biz_euros: (months * monthly).toFixed(2) }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const indivTotal = form.total_indiv_euros
      ? Math.round(Number(form.total_indiv_euros) * 100)
      : null;
    const indivMonthly = form.monthly_indiv_euros
      ? Math.round(Number(form.monthly_indiv_euros) * 100)
      : null;
    const bizTotal = form.total_biz_euros
      ? Math.round(Number(form.total_biz_euros) * 100)
      : null;
    const bizMonthly = form.monthly_biz_euros
      ? Math.round(Number(form.monthly_biz_euros) * 100)
      : null;

    if ((indivTotal == null || indivTotal <= 0) && (bizTotal == null || bizTotal <= 0)) {
      notify.warning("Indica al menos uno de los dos precios (Particular o Empresa)");
      return;
    }

    // Mínimos (opcionales, si el admin no los rellena los anclamos al total
    // individual para no bloquear con los checks de BD).
    const referenceTotal = indivTotal ?? bizTotal ?? 0;
    const minAuth = form.min_authorized_euros
      ? Math.round(Number(form.min_authorized_euros) * 100)
      : referenceTotal;
    const minAbs = form.absolute_min_euros
      ? Math.round(Number(form.absolute_min_euros) * 100)
      : minAuth;
    if (minAbs > minAuth || minAuth > referenceTotal) {
      notify.warning("Mínimos: absoluto ≤ comercial ≤ total particular");
      return;
    }

    // En renting, la financiera anticipa el TOTAL empresa menos comisión.
    // Si no hay precio empresa, usamos el individual como fallback para
    // que el campo legacy `financier_payment_cents` siga teniendo dato.
    const monthsVal = form.duration_months ? Number(form.duration_months) : null;
    const feePercent = form.financier_fee_percent ? Number(form.financier_fee_percent) : null;
    const bizFinancier =
      planType === "renting" && bizTotal != null
        ? Math.round(bizTotal * (1 - (feePercent ?? 0) / 100))
        : null;
    const legacyFinancier =
      planType === "renting" && indivTotal != null
        ? Math.round(indivTotal * (1 - (feePercent ?? 0) / 100))
        : bizFinancier;

    startTransition(async () => {
      try {
        await upsertPricingPlanAction({
          product_id: productId,
          plan_type: planType,
          duration_months: planType === "cash" ? null : monthsVal,
          // Legacy (rellenamos con individual para retro-compat)
          monthly_price_cents: planType === "cash" ? null : indivMonthly,
          total_price_cents: indivTotal ?? bizTotal,
          financing_coefficient:
            planType === "renting" && feePercent != null ? feePercent / 100 : null,
          financier_payment_cents: planType === "renting" ? legacyFinancier : null,
          // Duales
          monthly_price_individual_cents:
            planType === "cash" ? null : indivMonthly,
          monthly_price_business_cents:
            planType === "cash" ? null : bizMonthly,
          total_price_individual_cents: indivTotal,
          total_price_business_cents: bizTotal,
          financier_payment_business_cents:
            planType === "renting" ? bizFinancier : null,
          permanence_months:
            planType === "rental" ? Number(form.permanence_months) || null : null,
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
      className="space-y-4 rounded-xl border-2 border-primary bg-primary/5 p-4"
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
              readOnly={
                (planType === "renting" || planType === "rental") && fixedDuration != null
              }
              value={form.duration_months}
              onChange={(e) => setForm({ ...form, duration_months: e.target.value })}
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

      {/* PRECIOS DUALES */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Particular */}
        <div className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50/30 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Particular · IVA INCLUIDO
          </div>
          {planType !== "cash" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Cuota mensual (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.monthly_indiv_euros}
                onChange={(e) => setForm({ ...form, monthly_indiv_euros: e.target.value })}
                onBlur={recalcIndiv}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Total (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.total_indiv_euros}
              onChange={(e) => setForm({ ...form, total_indiv_euros: e.target.value })}
            />
          </div>
        </div>

        {/* Empresa / autónomo */}
        <div className="space-y-3 rounded-xl border-2 border-amber-200 bg-amber-50/30 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
            Empresa / autónomo · BASE (sin IVA)
          </div>
          {planType !== "cash" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Cuota mensual base (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.monthly_biz_euros}
                onChange={(e) => setForm({ ...form, monthly_biz_euros: e.target.value })}
                onBlur={recalcBiz}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Total base (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.total_biz_euros}
              onChange={(e) => setForm({ ...form, total_biz_euros: e.target.value })}
            />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        Puedes rellenar uno solo, los dos, o cualquier combinación. El sistema
        elige el bloque correspondiente según el tipo de cliente al hacer la
        propuesta.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Mín. comercial (€) — opcional</Label>
          <Input
            type="number"
            step="0.01"
            value={form.min_authorized_euros}
            onChange={(e) => setForm({ ...form, min_authorized_euros: e.target.value })}
            placeholder="por defecto = total"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mín. absoluto (€) — opcional</Label>
          <Input
            type="number"
            step="0.01"
            value={form.absolute_min_euros}
            onChange={(e) => setForm({ ...form, absolute_min_euros: e.target.value })}
            placeholder="por defecto = mín. comercial"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Mínimo comercial = nivel 3 puede vender sin aprobación. Mínimo absoluto =
        requiere aprobación nivel 1/2.
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
