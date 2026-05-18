"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/components/money-input";
import { notify } from "@/shared/hooks/use-toast";
import { createProposalAction, updateProposalAction } from "./actions";
import { PERIODICITY_OPTIONS, PLAN_TYPE_LABEL } from "./schemas";
import type { ProductForProposal } from "@/modules/products/actions";
import { pickPrice } from "./pick-price";

type PlanType = "cash" | "rental" | "renting";

interface PartyOption {
  id: string;
  name: string;
  /** party_kind/is_autonomo se usan para elegir precio individual vs business. */
  party_kind?: "individual" | "company" | null;
  is_autonomo?: boolean | null;
}

interface Props {
  customers: PartyOption[];
  leads?: PartyOption[];
  products: ProductForProposal[];
  defaultCustomerId?: string;
  defaultLeadId?: string;
  /**
   * Si true, al guardar se acepta la propuesta y se crea contrato
   * en el mismo paso (Escenario B - cliente acepta de palabra).
   */
  directMode?: boolean;
  /** Si está presente, modo edición: se actualiza la propuesta en vez de crear. */
  editId?: string;
  /**
   * Días por defecto de validez configurados en /configuracion/propuestas.
   * Si no llega, se usa 15 como fallback (comportamiento anterior).
   */
  defaultValidityDays?: number;
  /** Datos iniciales en modo edición. */
  initial?: {
    customer_id: string | null;
    lead_id: string | null;
    chosen_plan_type: PlanType;
    chosen_duration_months: number | null;
    validity_until: string | null;
    notes: string | null;
    items: ItemRow[];
  };
}

interface ItemRow {
  product_id: string;
  quantity: number;
  /** Cuota o precio total (cash=total, rental/renting=mensual). Céntimos. */
  unit_price_cents: number;
  installation_included: boolean;
  installation_price_cents: number | null;
  maintenance_included: boolean;
  maintenance_until_date: string | null;
  maintenance_price_cents: number | null;
  maintenance_periodicity_months: number | null;
  deposit_cents: number | null;
  charge_first_payment_now: boolean;
}

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/**
 * Para alquiler: el mantenimiento se incluye por defecto (cláusula
 * habitual del contrato). El comercial puede desmarcarlo si el cliente no
 * lo quiere. Para cash/renting queda opcional como antes.
 */
function rentalDefaultMaintenance(plan: PlanType, duration: number | null) {
  if (plan !== "rental") return { included: false, untilDate: null as string | null };
  const months = duration && duration > 0 ? duration : 12;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return { included: true, untilDate: d.toISOString().slice(0, 10) };
}

function emptyItem(
  productId: string,
  plan: PlanType,
  plans: ProductForProposal["plans"],
  duration: number | null,
  destinatario: PartyOption | null,
): ItemRow {
  const planMatch = plans.find((p) => {
    if (p.plan_type !== plan) return false;
    if (plan === "renting" && duration) return p.duration_months === duration;
    return true;
  });
  const maintDef = rentalDefaultMaintenance(plan, duration);
  if (!planMatch) {
    return {
      product_id: productId,
      quantity: 1,
      unit_price_cents: 0,
      installation_included: true,
      installation_price_cents: null,
      maintenance_included: maintDef.included,
      maintenance_until_date: maintDef.untilDate,
      maintenance_price_cents: null,
      maintenance_periodicity_months: 12,
      deposit_cents: null,
      charge_first_payment_now: false,
    };
  }
  // pickPrice elige individual vs business según destinatario.
  const picked = pickPrice(planMatch, destinatario);
  const cuota =
    plan === "cash" ? picked.total_cents : picked.monthly_cents ?? 0;
  return {
    product_id: productId,
    quantity: 1,
    unit_price_cents: cuota,
    installation_included: true,
    installation_price_cents: null,
    maintenance_included: maintDef.included,
    maintenance_until_date: maintDef.untilDate,
    maintenance_price_cents: null,
    maintenance_periodicity_months: 12,
    deposit_cents: null,
    charge_first_payment_now: false,
  };
}

export function ProposalCreateForm({
  customers,
  leads = [],
  products,
  defaultCustomerId,
  defaultLeadId,
  directMode = false,
  editId,
  defaultValidityDays = 15,
  initial,
}: Props) {
  const isEdit = !!editId;
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? defaultCustomerId ?? "");
  /**
   * Resuelve el destinatario actual (customer o lead) a partir de los
   * arrays que llegan por props. Sirve para `pickPrice` (individual vs
   * business) y para la etiqueta "IVA incluido / Base + IVA".
   */
  const leadIdEffective = defaultLeadId ?? initial?.lead_id ?? null;
  const destinatario: PartyOption | null = customerId
    ? customers.find((c) => c.id === customerId) ?? null
    : leadIdEffective
      ? leads.find((l) => l.id === leadIdEffective) ?? null
      : null;
  const [validityUntil, setValidityUntil] = useState(() => {
    if (initial?.validity_until) return initial.validity_until;
    // Por defecto: hoy + N días según /configuracion/propuestas.
    const d = new Date();
    d.setDate(d.getDate() + defaultValidityDays);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [planType, setPlanType] = useState<PlanType>(initial?.chosen_plan_type ?? "cash");
  const [duration, setDuration] = useState<number | null>(
    initial?.chosen_duration_months ?? 48,
  );
  const [items, setItems] = useState<ItemRow[]>(initial?.items ?? []);
  const [pending, startTransition] = useTransition();

  // Nota: la financiera NO se elige en la propuesta. La elige el admin
  // sobre el contrato firmado, después de pasar la solicitud a varias
  // financieras y recibir la aceptación. El comercial solo trabaja con la
  // cuota fija del producto. Por eso el form de propuesta no toca
  // financier_id / financier_payment_cents / coef — quedan null hasta
  // que admin los asigne desde /contratos/[id].

  const availableProducts = useMemo(
    () =>
      products.filter((p) =>
        p.plans.some((pl) => {
          if (pl.plan_type !== planType) return false;
          if (planType === "renting" && duration) return pl.duration_months === duration;
          return true;
        }),
      ),
    [products, planType, duration],
  );

  const rentingDurations = useMemo(() => {
    if (planType !== "renting") return [];
    const all = new Set<number>();
    products.forEach((p) =>
      p.plans
        .filter((pl) => pl.plan_type === "renting" && pl.duration_months)
        .forEach((pl) => all.add(pl.duration_months!)),
    );
    return Array.from(all).sort((a, b) => a - b);
  }, [products, planType]);

  function addItem() {
    if (availableProducts.length === 0) {
      notify.warning(`No hay productos con plan ${PLAN_TYPE_LABEL[planType]} configurado`);
      return;
    }
    const first = availableProducts[0]!;
    setItems((prev) => [
      ...prev,
      emptyItem(first.id, planType, first.plans, duration, destinatario),
    ]);
  }

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if (patch.product_id) {
          const prod = products.find((p) => p.id === patch.product_id);
          if (prod) {
            const fresh = emptyItem(
              patch.product_id,
              planType,
              prod.plans,
              duration,
              destinatario,
            );
            return { ...next, ...fresh, quantity: next.quantity };
          }
        }
        return next;
      }),
    );
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function changePlan(newPlan: PlanType) {
    setPlanType(newPlan);
    setItems([]);
    if (newPlan === "rental" && !duration) setDuration(48);
    if (newPlan === "cash") setDuration(null);
  }

  const approvalNeeded = items.some((it) => {
    const prod = products.find((p) => p.id === it.product_id);
    if (!prod) return false;
    const plan = prod.plans.find((pl) => {
      if (pl.plan_type !== planType) return false;
      if (planType === "renting" && duration) return pl.duration_months === duration;
      return true;
    });
    return plan?.min_authorized_cents != null && it.unit_price_cents < plan.min_authorized_cents;
  });

  function submit() {
    if (!customerId && !defaultLeadId) {
      notify.warning("Selecciona destinatario");
      return;
    }
    if (items.length === 0) {
      notify.warning("Añade al menos un producto");
      return;
    }
    for (const it of items) {
      if (
        !it.maintenance_included &&
        ((it.maintenance_price_cents ?? 0) < 0 || !it.maintenance_periodicity_months)
      ) {
        notify.warning("Precio + periodicidad de mantenimiento obligatorios cuando no incluido");
        return;
      }
    }
    startTransition(async () => {
      try {
        const payload = {
          customer_id: customerId || undefined,
          lead_id: defaultLeadId ?? initial?.lead_id ?? undefined,
          chosen_plan_type: planType,
          chosen_duration_months: planType === "cash" ? null : duration,
          validity_until: validityUntil || undefined,
          notes,
          items,
          auto_accept: directMode,
          // La financiera (financier_id, payment, coef, residual, reserva)
          // la asigna admin sobre el contrato firmado, NO el comercial.
          financier_id: null,
          financier_payment_cents: null,
          financier_term_months: null,
          financier_coefficient: null,
          financier_residual_cents: null,
          financier_reserve_cents: null,
        };
        if (isEdit && editId) {
          await updateProposalAction(editId, payload);
        } else {
          await createProposalAction(payload);
        }
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-6 rounded-2xl border bg-card p-6">
      <div className="space-y-2">
        <Label>{defaultLeadId ? "Lead" : "Cliente *"}</Label>
        {defaultLeadId ? (
          <div className="flex h-12 w-full items-center rounded-xl border border-input bg-muted/30 px-3 font-semibold">
            {leads.find((l) => l.id === defaultLeadId)?.name ?? "Lead"}
          </div>
        ) : (
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
          >
            <option value="">Selecciona un cliente</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2">
        <Label>Plan de pago de la propuesta *</Label>
        <div className="flex gap-2">
          {(["cash", "rental", "renting"] as PlanType[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => changePlan(p)}
              className={`flex-1 rounded-xl border-2 p-4 text-center font-bold transition-all ${
                planType === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/30"
              }`}
            >
              {PLAN_TYPE_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Toda la propuesta usa un único plan. Si quieres ofrecer dos opciones (alquiler y
          contado), crea dos propuestas separadas y el cliente elige una.
        </p>
      </div>

      {planType === "rental" && (
        <div className="space-y-2">
          <Label>Permanencia (meses) *</Label>
          <Input
            type="number"
            min={1}
            value={duration ?? 48}
            onChange={(e) => setDuration(Number(e.target.value) || 48)}
            className="max-w-[200px]"
          />
          <p className="text-xs text-muted-foreground">Por defecto 48 meses, modificable.</p>
        </div>
      )}

      {planType === "renting" && (
        <div className="space-y-2">
          <Label>Duración renting *</Label>
          <div className="flex flex-wrap gap-2">
            {rentingDurations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ningún producto tiene plan de renting configurado.
              </p>
            ) : (
              rentingDurations.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(m)}
                  className={`rounded-xl border-2 px-4 py-2 font-bold ${
                    duration === m
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  {m} meses
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Productos</Label>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-4 w-4" /> Añadir producto
          </Button>
        </div>

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Sin productos. Pulsa &laquo;Añadir producto&raquo; para empezar.
          </div>
        )}

        {items.map((it, idx) => (
          <ItemEditor
            key={idx}
            item={it}
            availableProducts={availableProducts}
            allProducts={products}
            planType={planType}
            duration={duration}
            onChange={(patch) => updateItem(idx, patch)}
            onRemove={() => removeItem(idx)}
          />
        ))}
      </fieldset>

      {approvalNeeded && (
        <div className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>
            Alguna cuota está por debajo del mínimo autorizado. Al guardar, la propuesta quedará{" "}
            <strong>pendiente de aprobación</strong> de admin/director.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* "Validez hasta" sólo tiene sentido en propuesta formal —
            indica hasta cuándo el cliente puede aceptarla. En modo
            contrato directo NO se muestra: la aceptación es inmediata. */}
        {!directMode && (
          <div className="space-y-2">
            <Label>Validez hasta</Label>
            <Input
              type="date"
              value={validityUntil}
              onChange={(e) => setValidityUntil(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Hasta cuándo el cliente puede aceptar la propuesta. Pasada
              esta fecha, la propuesta caduca automáticamente.
            </p>
          </div>
        )}
        <div className={`space-y-2 ${directMode ? "sm:col-span-2" : "sm:col-span-2"}`}>
          <Label>Notas (opcional)</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-card p-3 text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button onClick={submit} disabled={pending} variant="success" size="lg">
          {pending
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear propuesta"}
        </Button>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  availableProducts,
  allProducts,
  planType,
  duration,
  onChange,
  onRemove,
}: {
  item: ItemRow;
  availableProducts: ProductForProposal[];
  allProducts: ProductForProposal[];
  planType: PlanType;
  duration: number | null;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}) {
  const product = allProducts.find((p) => p.id === item.product_id);
  const plan = product?.plans.find((pl) => {
    if (pl.plan_type !== planType) return false;
    if (planType === "renting" && duration) return pl.duration_months === duration;
    return true;
  });
  const minAuth = plan?.min_authorized_cents ?? null;
  const belowMin = minAuth != null && item.unit_price_cents < minAuth;
  const cuotaLabel = planType === "cash" ? "Precio total (€)" : "Cuota mensual (€)";

  return (
    <div className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex items-start gap-3">
        <select
          value={item.product_id}
          onChange={(e) => onChange({ product_id: e.target.value })}
          className="h-11 flex-1 rounded-md border border-input bg-background px-3 text-base"
        >
          {availableProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon" onClick={onRemove} type="button">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Cantidad</Label>
          <Input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">{cuotaLabel}</Label>
          <MoneyInput
            valueCents={item.unit_price_cents}
            onChangeCents={(c) => onChange({ unit_price_cents: c })}
            className={belowMin ? "border-amber-400 focus-visible:ring-amber-400" : ""}
          />
          {belowMin && (
            <p className="text-[10px] text-amber-700">
              Por debajo del mínimo autorizado ({eur(minAuth)}). Requerirá aprobación.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.installation_included}
            onChange={(e) => onChange({ installation_included: e.target.checked })}
            className="h-4 w-4"
          />
          <span className="text-sm font-bold">Instalación incluida en la cuota / precio</span>
        </label>
        {!item.installation_included && (
          <div className="mt-2 space-y-1">
            <Label className="text-xs">Precio instalación aparte (€)</Label>
            <MoneyInput
              valueCents={item.installation_price_cents ?? 0}
              onChangeCents={(c) => onChange({ installation_price_cents: c })}
              className="max-w-[200px]"
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/20 p-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.maintenance_included}
            onChange={(e) => {
              const enabling = e.target.checked;
              // Si activa mantenimiento incluido y no hay fecha, prerellenamos
              // con la duración del contrato (paso anterior). Editable luego.
              if (enabling && !item.maintenance_until_date && duration) {
                const d = new Date();
                d.setMonth(d.getMonth() + duration);
                onChange({
                  maintenance_included: true,
                  maintenance_until_date: d.toISOString().slice(0, 10),
                });
              } else {
                onChange({ maintenance_included: enabling });
              }
            }}
            className="h-4 w-4"
          />
          <span className="text-sm font-bold">Mantenimiento incluido</span>
        </label>
        {item.maintenance_included ? (
          <div className="mt-2 space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Cubierto hasta fecha</Label>
              <div className="flex flex-wrap items-center gap-2">
                {[12, 24, 36, 48].map((m) => {
                  const isContractDuration = duration === m;
                  let isSelected = false;
                  if (item.maintenance_until_date) {
                    const target = new Date();
                    target.setMonth(target.getMonth() + m);
                    const current = new Date(item.maintenance_until_date);
                    const diffDays =
                      Math.abs(current.getTime() - target.getTime()) / (1000 * 60 * 60 * 24);
                    isSelected = diffDays < 5;
                  }
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + m);
                        onChange({
                          maintenance_until_date: d.toISOString().slice(0, 10),
                        });
                      }}
                      className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                      title={
                        isContractDuration
                          ? `★ Coincide con duración del contrato (${m} meses)`
                          : `${m} meses desde hoy`
                      }
                    >
                      {m} meses{isContractDuration ? " ★" : ""}
                    </button>
                  );
                })}
                <Input
                  type="date"
                  value={item.maintenance_until_date ?? ""}
                  onChange={(e) => onChange({ maintenance_until_date: e.target.value || null })}
                  className="max-w-[180px]"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Pulsa un botón para calcular fecha rápida o edita a mano.{" "}
                {duration
                  ? `★ marca la duración del contrato (${duration} meses).`
                  : null}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Periodicidad (cada cuántos meses)</Label>
              <select
                value={item.maintenance_periodicity_months ?? 12}
                onChange={(e) =>
                  onChange({ maintenance_periodicity_months: Number(e.target.value) })
                }
                className="h-10 w-full max-w-[180px] rounded-md border border-input bg-background px-2 text-sm"
              >
                {PERIODICITY_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    cada {m} meses
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Cuántos meses pasan entre un mantenimiento y el siguiente.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Precio mantenimiento (€)</Label>
              <MoneyInput
                valueCents={item.maintenance_price_cents ?? 0}
                onChangeCents={(c) => onChange({ maintenance_price_cents: c })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Periodicidad (meses)</Label>
              <select
                value={item.maintenance_periodicity_months ?? 12}
                onChange={(e) =>
                  onChange({ maintenance_periodicity_months: Number(e.target.value) })
                }
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {PERIODICITY_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} meses
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {planType === "rental" && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.deposit_cents != null}
                onChange={(e) =>
                  onChange({ deposit_cents: e.target.checked ? 0 : null })
                }
                className="h-4 w-4"
              />
              <span className="text-sm font-bold">Lleva fianza</span>
            </label>
            {item.deposit_cents != null && (
              <div className="mt-2 space-y-1">
                <Label className="text-xs">Importe fianza (€)</Label>
                <MoneyInput
                  valueCents={item.deposit_cents}
                  onChangeCents={(c) => onChange({ deposit_cents: c })}
                  className="max-w-[200px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  Por producto. Al finalizar el contrato podrás devolverla
                  íntegra, parcial o retenerla como penalización.
                </p>
              </div>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.charge_first_payment_now}
                onChange={(e) =>
                  onChange({ charge_first_payment_now: e.target.checked })
                }
                className="h-4 w-4"
              />
              <span className="text-sm font-bold">Cobrar 1ª cuota al firmar</span>
            </label>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Si activo: el cliente paga {duration ? duration - 1 : "N-1"} cuotas
              restantes a partir del mes siguiente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
