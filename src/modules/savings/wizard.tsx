"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  Building2,
  Droplets,
  GlassWater,
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Leaf,
  Recycle,
  TrendingDown,
  Save,
  Download,
  Mail,
  Calendar,
  Banknote,
  Zap,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  type CalcInputs,
  type CalcResult,
  type ClientType,
  type CurrentService,
  type PlanType,
  recommendedDispensers,
} from "./calc";
import {
  saveSavingsProposalAction,
  type SavingsBrand,
  type WizardExtra,
  type WizardProduct,
} from "./actions";

interface Props {
  initialBrands: SavingsBrand[];
  initialProducts: { home: WizardProduct[]; office: WizardProduct[] } | null;
  initialExtras: WizardExtra[] | null;
  config: {
    osmosis_annual_cost_cents: number;
    liters_per_person_day_home: number;
    liters_per_person_day_office: number;
    co2_per_bottle_kg: number;
    plastic_per_bottle_kg: number;
    default_bottle_size_liters: number;
    service_garrafa_size_liters: number;
    service_cycles_per_year: number;
    recommended_dispensers_threshold: number;
  };
  defaultLeadId?: string | null;
  defaultCustomerId?: string | null;
  defaultLeadName?: string | null;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const STEP_LABELS: Record<Step, string> = {
  1: "Tipo de cliente",
  2: "Personas",
  3: "Servicio actual",
  4: "Marca de agua",
  5: "Cantidad",
  6: "Plan",
  7: "Producto",
  8: "Extras",
  9: "Resultado",
};

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function SavingsWizard(props: Props) {
  const {
    initialBrands,
    initialProducts,
    initialExtras,
    config,
    defaultLeadId,
    defaultCustomerId,
    defaultLeadName,
  } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>(1);
  const [clientType, setClientType] = useState<ClientType | null>(null);
  const [numPeople, setNumPeople] = useState(2);
  const [litersPerPersonOverride, setLitersOverride] = useState<number | null>(null);

  const [currentService, setCurrentService] = useState<CurrentService | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [customBrandName, setCustomBrandName] = useState("");
  const [customPricePerLiter, setCustomPricePerLiter] = useState(""); // €/L

  const [garrafasPerMonth, setGarrafasPerMonth] = useState(3);

  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [duration, setDuration] = useState<number | null>(48);

  const [productId, setProductId] = useState<string | null>(null);
  const [extraTapId, setExtraTapId] = useState<string | null>(null);
  const [extraCoolerId, setExtraCoolerId] = useState<string | null>(null);

  const [result, setResult] = useState<CalcResult | null>(null);
  const [calcDone, setCalcDone] = useState(false);

  const products =
    clientType === "home"
      ? initialProducts?.home ?? []
      : initialProducts?.office ?? [];
  const productsForPlan = products.filter((p) =>
    p.pricing.some((pr) => pr.plan_type === planType),
  );
  const selectedProduct = products.find((p) => p.id === productId);
  const selectedExtras = (initialExtras ?? []).filter(
    (e) => e.id === extraTapId || e.id === extraCoolerId,
  );
  const taps = (initialExtras ?? []).filter((e) => e.extra_role === "tap");
  const coolers = (initialExtras ?? []).filter((e) => e.extra_role === "cooler");

  // Determinar si el producto seleccionado admite extras
  const acceptsExtras = !!selectedProduct?.category_accepts_extras;

  // Calcular resultado al llegar al paso 9
  useEffect(() => {
    if (step !== 9) return;
    if (calcDone) return;
    if (!clientType || !planType || !currentService || !selectedProduct) return;

    const planRow = selectedProduct.pricing.find((pr) => {
      if (pr.plan_type !== planType) return false;
      if (planType === "renting") return pr.duration_months === duration;
      return true;
    });
    if (!planRow) {
      notify.warning("El producto no tiene plan configurado para esa duración");
      return;
    }
    const productUnitCents =
      planType === "cash" ? planRow.total_cents ?? 0 : planRow.monthly_cents ?? 0;
    const numUnits = recommendedDispensers(config, { client_type: clientType, num_people: numPeople });

    // Brand seleccionada
    let pricePerLiterCents: number | null = null;
    let servicePriceCents: number | null = null;
    let chosenBrand: SavingsBrand | null = null;
    if (currentService === "bottled") {
      if (brandId === "custom") {
        const v = Number(customPricePerLiter.replace(",", "."));
        pricePerLiterCents = Number.isFinite(v) ? Math.round(v * 100) : null;
      } else {
        chosenBrand = initialBrands.find((b) => b.id === brandId) ?? null;
        pricePerLiterCents = chosenBrand?.price_per_liter_cents ?? null;
      }
    } else if (currentService === "service") {
      chosenBrand = initialBrands.find((b) => b.id === brandId) ?? null;
      const prices = chosenBrand?.prices_by_garrafas ?? {};
      servicePriceCents = (prices[String(garrafasPerMonth)] ?? null) as number | null;
    }

    // Mapear extras a inputs
    const extrasInputs = selectedExtras
      .map((e) => {
        const pr = e.pricing.find((p) => {
          if (p.plan_type !== planType) return false;
          if (planType === "renting") return p.duration_months === duration;
          return true;
        });
        if (!pr) return null;
        if (planType === "cash") {
          return {
            cash_price_cents: pr.total_cents ?? 0,
            install_cents: e.install_cents ?? 0,
          };
        }
        return { monthly_cents: pr.monthly_cents ?? 0 };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const inputs: CalcInputs = {
      client_type: clientType,
      num_people: numPeople,
      liters_per_person_day_override: litersPerPersonOverride ?? undefined,
      current_service: currentService,
      current_price_per_liter_cents: pricePerLiterCents,
      service_garrafas_per_month: servicePriceCents ? garrafasPerMonth : null,
      service_price_garrafa_cents: servicePriceCents,
      plan_type: planType,
      duration_months: planType === "renting" ? duration : null,
      product_unit_price_cents: productUnitCents,
      num_units: numUnits,
      extras: extrasInputs,
      deposit_cents:
        planType === "rental" ? planRow.deposit_cents ?? 0 : 0,
    };

    // Calcular en cliente con la misma fórmula del server
    import("./calc").then(({ computeSavings }) => {
      setResult(computeSavings(config, inputs));
      setCalcDone(true);
    });
  }, [
    step,
    calcDone,
    clientType,
    planType,
    currentService,
    selectedProduct,
    duration,
    numPeople,
    litersPerPersonOverride,
    brandId,
    customPricePerLiter,
    garrafasPerMonth,
    selectedExtras,
    initialBrands,
    config,
  ]);

  // Navegación inteligente: skip de pasos según estado
  function nextStep() {
    let next = (step + 1) as Step;
    // Skip step 4 (marca) si servicio actual no es bottled/service
    if (next === 4 && currentService !== "bottled" && currentService !== "service") {
      next = 5 as Step;
    }
    // Skip step 5 (cantidad) si no es service
    if (next === 5 && currentService !== "service") {
      next = 6 as Step;
    }
    // Skip step 8 (extras) si producto no admite
    if (next === 8 && !acceptsExtras) {
      next = 9 as Step;
    }
    setStep(next);
    setCalcDone(false);
  }

  function prevStep() {
    let prev = (step - 1) as Step;
    if (prev === 8 && !acceptsExtras) prev = 7 as Step;
    if (prev === 5 && currentService !== "service") prev = 4 as Step;
    if (prev === 4 && currentService !== "bottled" && currentService !== "service") {
      prev = 3 as Step;
    }
    if (prev < 1) prev = 1 as Step;
    setStep(prev);
  }

  function canAdvance(): boolean {
    if (step === 1) return clientType != null;
    if (step === 2) return numPeople > 0;
    if (step === 3) return currentService != null;
    if (step === 4) {
      if (brandId === "custom") {
        return customBrandName.trim().length > 0 && Number(customPricePerLiter) > 0;
      }
      return brandId != null;
    }
    if (step === 5) return garrafasPerMonth > 0;
    if (step === 6) {
      if (planType == null) return false;
      if (planType === "renting") return duration != null && duration > 0;
      return true;
    }
    if (step === 7) return productId != null;
    return true;
  }

  function save() {
    if (!result || !clientType || !currentService || !planType || !selectedProduct) return;

    const chosenBrand =
      brandId && brandId !== "custom" ? initialBrands.find((b) => b.id === brandId) : null;
    const planRow = selectedProduct.pricing.find((pr) => {
      if (pr.plan_type !== planType) return false;
      if (planType === "renting") return pr.duration_months === duration;
      return true;
    });
    if (!planRow) return;
    const productUnitCents =
      planType === "cash" ? planRow.total_cents ?? 0 : planRow.monthly_cents ?? 0;
    const numUnits = recommendedDispensers(config, { client_type: clientType, num_people: numPeople });

    const extrasSnapshot = selectedExtras
      .map((e) => {
        const pr = e.pricing.find((p) => {
          if (p.plan_type !== planType) return false;
          if (planType === "renting") return p.duration_months === duration;
          return true;
        });
        if (!pr) return null;
        return {
          product_id: e.id,
          name: e.name,
          role: e.extra_role,
          monthly_cents: planType === "cash" ? 0 : pr.monthly_cents ?? 0,
          install_cents: planType === "cash" ? (e.install_cents ?? 0) + (pr.total_cents ?? 0) : 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    let pricePerLiterCents: number | null = null;
    if (currentService === "bottled") {
      if (brandId === "custom") {
        const v = Number(customPricePerLiter.replace(",", "."));
        pricePerLiterCents = Number.isFinite(v) ? Math.round(v * 100) : null;
      } else {
        pricePerLiterCents = chosenBrand?.price_per_liter_cents ?? null;
      }
    }

    const inputs: CalcInputs = {
      client_type: clientType,
      num_people: numPeople,
      liters_per_person_day_override: litersPerPersonOverride ?? undefined,
      current_service: currentService,
      current_price_per_liter_cents: pricePerLiterCents,
      service_garrafas_per_month:
        currentService === "service" ? garrafasPerMonth : null,
      service_price_garrafa_cents:
        currentService === "service"
          ? ((chosenBrand?.prices_by_garrafas ?? {})[String(garrafasPerMonth)] ?? null) as
              | number
              | null
          : null,
      plan_type: planType,
      duration_months: planType === "renting" ? duration : null,
      product_unit_price_cents: productUnitCents,
      num_units: numUnits,
      extras: [],
      deposit_cents:
        planType === "rental" ? planRow.deposit_cents ?? 0 : 0,
    };

    startTransition(async () => {
      const r = await saveSavingsProposalAction({
        customer_id: defaultCustomerId,
        lead_id: defaultLeadId,
        inputs,
        brand_id: chosenBrand?.id ?? null,
        brand_name_snapshot:
          brandId === "custom" ? customBrandName : chosenBrand?.name ?? null,
        service_garrafas_per_month:
          currentService === "service" ? garrafasPerMonth : null,
        product_id: selectedProduct.id,
        product_name_snapshot: selectedProduct.name,
        extras_snapshot: extrasSnapshot,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Propuesta de ahorro guardada", `Ref. ${r.id.slice(0, 8)}`);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Stepper */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto rounded-2xl border bg-card p-3">
        {([1, 2, 3, 4, 5, 6, 7, 8, 9] as Step[]).map((n) => {
          const active = step === n;
          const done = step > n;
          return (
            <div
              key={n}
              className={`flex items-center gap-2 ${active ? "" : done ? "opacity-60" : "opacity-30"}`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : n}
              </div>
              <span className="hidden text-xs font-semibold sm:inline">{STEP_LABELS[n]}</span>
            </div>
          );
        })}
      </div>

      {/* Contenido del paso */}
      <div className="rounded-2xl border bg-card p-6 min-h-[320px]">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">¿Para quién es la calculadora?</h2>
            <p className="text-sm text-muted-foreground">
              Selecciona el tipo de cliente para personalizar el cálculo.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { val: "home" as const, label: "Hogar / Particular", icon: Home },
                { val: "office" as const, label: "Empresa / Oficina", icon: Building2 },
              ].map((o) => {
                const Icon = o.icon;
                const sel = clientType === o.val;
                return (
                  <button
                    key={o.val}
                    type="button"
                    onClick={() => {
                      setClientType(o.val);
                      setTimeout(() => nextStep(), 200);
                    }}
                    className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition ${
                      sel
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`h-12 w-12 ${sel ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-bold">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">¿Cuántas personas?</h2>
            <p className="text-sm text-muted-foreground">
              {clientType === "office"
                ? "Personas que beberán agua a diario en la oficina."
                : "Personas que viven en el hogar."}
            </p>
            <div className="space-y-3">
              <Label>Número de personas</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNumPeople((n) => Math.max(1, n - 1))}
                >
                  −
                </Button>
                <Input
                  type="number"
                  value={numPeople}
                  onChange={(e) => setNumPeople(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="text-center text-2xl font-bold w-24"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNumPeople((n) => n + 1)}
                >
                  +
                </Button>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Ajustar litros/persona/día (opcional — por defecto{" "}
                  {clientType === "office"
                    ? config.liters_per_person_day_office
                    : config.liters_per_person_day_home}{" "}
                  L)
                </summary>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={litersPerPersonOverride ?? ""}
                    placeholder={String(
                      clientType === "office"
                        ? config.liters_per_person_day_office
                        : config.liters_per_person_day_home,
                    )}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      setLitersOverride(v);
                    }}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">L/persona/día</span>
                </div>
              </details>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">¿Qué consume hoy el cliente?</h2>
            <p className="text-sm text-muted-foreground">El servicio o agua que usa actualmente.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { val: "bottled" as const, label: "Botellas de supermercado", icon: ShoppingCart },
                  { val: "service" as const, label: "Servicio de garrafas (Aquaservice…)", icon: Droplets },
                  { val: "osmosis" as const, label: "Ósmosis ya instalada", icon: Zap },
                  { val: "tap" as const, label: "Solo agua del grifo", icon: GlassWater },
                ] as Array<{ val: CurrentService; label: string; icon: typeof ShoppingCart }>
              ).map((o) => {
                const Icon = o.icon;
                const sel = currentService === o.val;
                return (
                  <button
                    key={o.val}
                    type="button"
                    onClick={() => {
                      setCurrentService(o.val);
                      setBrandId(null);
                    }}
                    className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left transition ${
                      sel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`h-7 w-7 shrink-0 ${sel ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-bold">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">
              {currentService === "service" ? "¿Qué empresa de servicio?" : "¿Qué marca compra?"}
            </h2>
            <div className="grid gap-2">
              {initialBrands
                .filter((b) =>
                  currentService === "service" ? b.kind === "service" : b.kind === "supermarket",
                )
                .map((b) => {
                  const sel = brandId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBrandId(b.id)}
                      className={`flex items-center justify-between gap-3 rounded-xl border-2 p-3 text-left transition ${
                        sel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <span className="font-bold">{b.name}</span>
                      {b.kind === "supermarket" && b.price_per_liter_cents && (
                        <span className="text-sm text-muted-foreground">
                          {(b.price_per_liter_cents / 100).toFixed(2)} €/L
                        </span>
                      )}
                    </button>
                  );
                })}
              <button
                type="button"
                onClick={() => setBrandId("custom")}
                className={`rounded-xl border-2 border-dashed p-3 text-left ${
                  brandId === "custom" ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="font-bold">+ Otra marca (precio libre)</span>
              </button>
              {brandId === "custom" && (
                <div className="rounded-xl bg-muted/30 p-3 space-y-2">
                  <Input
                    placeholder="Nombre de la marca"
                    value={customBrandName}
                    onChange={(e) => setCustomBrandName(e.target.value)}
                  />
                  {currentService === "bottled" && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Precio €/litro"
                        value={customPricePerLiter}
                        onChange={(e) => setCustomPricePerLiter(e.target.value)}
                        className="max-w-[140px]"
                      />
                      <span className="text-xs text-muted-foreground">€/litro</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">¿Cuántas garrafas al mes?</h2>
            <p className="text-sm text-muted-foreground">
              Garrafas de {config.service_garrafa_size_liters} L que el cliente compra cada mes.
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGarrafasPerMonth(n)}
                  className={`rounded-xl border-2 p-4 font-bold ${
                    garrafasPerMonth === n
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">¿Qué plan le ofrecemos?</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { val: "cash", label: "Compra (contado)", icon: Banknote },
                  { val: "rental", label: "Alquiler", icon: Calendar },
                  { val: "renting", label: "Renting", icon: Calendar },
                ] satisfies Array<{ val: PlanType; label: string; icon: typeof Banknote }>
              ).map((o) => {
                const Icon = o.icon;
                const sel = planType === o.val;
                return (
                  <button
                    key={o.val}
                    type="button"
                    onClick={() => setPlanType(o.val)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 transition ${
                      sel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`h-8 w-8 ${sel ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-bold text-sm">{o.label}</span>
                  </button>
                );
              })}
            </div>
            {planType === "renting" && (
              <div className="space-y-2">
                <Label>Duración (meses)</Label>
                <div className="flex gap-2 flex-wrap">
                  {[12, 24, 36, 48, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDuration(m)}
                      className={`rounded-xl border-2 px-4 py-2 font-bold ${
                        duration === m
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      {m} m
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Elige producto</h2>
            {productsForPlan.length === 0 ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                ⚠ No hay productos para {clientType === "home" ? "hogar" : "empresa"} con plan{" "}
                {planType}. Configura al menos un producto en /productos.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {productsForPlan.map((p) => {
                  const sel = productId === p.id;
                  const planRow = p.pricing.find((pr) => {
                    if (pr.plan_type !== planType) return false;
                    if (planType === "renting") return pr.duration_months === duration;
                    return true;
                  });
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProductId(p.id);
                        // reset extras
                        setExtraTapId(null);
                        setExtraCoolerId(null);
                      }}
                      className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition ${
                        sel ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Zap
                          className={`h-5 w-5 ${
                            p.product_type_hint === "osmosis"
                              ? "text-blue-600"
                              : "text-emerald-600"
                          }`}
                        />
                        <span className="font-bold flex-1">{p.name}</span>
                        {p.category_accepts_extras && (
                          <span className="text-[10px] uppercase tracking-wider rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">
                            +Extras
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">{p.category_name}</span>
                      <span className="text-xl font-bold">
                        {planType === "cash"
                          ? eur(planRow?.total_cents)
                          : `${eur(planRow?.monthly_cents)}/mes`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 8 && acceptsExtras && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Extras (opcionales)</h2>
            <p className="text-sm text-muted-foreground">
              Añade grifería y/o enfriador. Se suma al coste mensual.
            </p>

            {/* Grifería */}
            <div>
              <h3 className="font-bold mb-2">Grifería</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <ExtraOption
                  selected={extraTapId === null}
                  onClick={() => setExtraTapId(null)}
                  label="Sin grifería"
                  price={null}
                />
                {taps.map((e) => {
                  const planRow = e.pricing.find((pr) => {
                    if (pr.plan_type !== planType) return false;
                    if (planType === "renting") return pr.duration_months === duration;
                    return true;
                  });
                  const price =
                    planType === "cash" ? planRow?.total_cents : planRow?.monthly_cents;
                  const vias = e.attributes?.vias ?? e.attributes?.via;
                  return (
                    <ExtraOption
                      key={e.id}
                      selected={extraTapId === e.id}
                      onClick={() => setExtraTapId(e.id)}
                      label={e.name}
                      sublabel={vias ? `${vias} vías` : null}
                      price={price ?? null}
                      planType={planType ?? "cash"}
                    />
                  );
                })}
              </div>
            </div>

            {/* Enfriador */}
            <div>
              <h3 className="font-bold mb-2">Enfriador</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <ExtraOption
                  selected={extraCoolerId === null}
                  onClick={() => setExtraCoolerId(null)}
                  label="Sin enfriador"
                  price={null}
                />
                {coolers.map((e) => {
                  const planRow = e.pricing.find((pr) => {
                    if (pr.plan_type !== planType) return false;
                    if (planType === "renting") return pr.duration_months === duration;
                    return true;
                  });
                  const price =
                    planType === "cash" ? planRow?.total_cents : planRow?.monthly_cents;
                  return (
                    <ExtraOption
                      key={e.id}
                      selected={extraCoolerId === e.id}
                      onClick={() => setExtraCoolerId(e.id)}
                      label={e.name}
                      price={price ?? null}
                      planType={planType ?? "cash"}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 9 && (
          <ResultPanel
            result={result}
            planType={planType ?? "cash"}
            productName={selectedProduct?.name ?? ""}
            leadName={defaultLeadName ?? null}
            onSave={save}
            saving={pending}
          />
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={step === 1 || pending}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" /> Atrás
        </Button>
        {step < 9 ? (
          <Button
            onClick={nextStep}
            disabled={!canAdvance() || pending}
            variant="success"
            className="gap-2"
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" onClick={() => router.push("/dashboard" as never)}>
            Cerrar
          </Button>
        )}
      </div>
    </div>
  );
}

function ExtraOption({
  selected,
  onClick,
  label,
  sublabel,
  price,
  planType,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sublabel?: string | null;
  price: number | null | undefined;
  planType?: "cash" | "rental" | "renting";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-xl border-2 p-3 text-left transition ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="min-w-0">
        <div className="font-bold">{label}</div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
      </div>
      {price != null && (
        <span className="font-bold text-sm">
          {planType === "cash" ? eur(price) : `${eur(price)}/mes`}
        </span>
      )}
    </button>
  );
}

function ResultPanel({
  result,
  planType,
  productName,
  leadName,
  onSave,
  saving,
}: {
  result: CalcResult | null;
  planType: PlanType;
  productName: string;
  leadName: string | null;
  onSave: () => void;
  saving: boolean;
}) {
  if (!result) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Calculando…</p>
      </div>
    );
  }
  const noSavings = result.payback_months == null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Comparativa de ahorro</h2>
        {leadName && (
          <p className="text-sm text-muted-foreground">Para {leadName}</p>
        )}
      </div>

      {/* Comparativa de costes */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-rose-700">
            Tu coste actual
          </div>
          <div className="mt-1 text-3xl font-bold text-rose-900 tabular-nums">
            {eur(result.current_monthly_cost_cents)}
            <span className="text-sm font-medium">/mes</span>
          </div>
        </div>
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            Con nosotros ({productName})
          </div>
          <div className="mt-1 text-3xl font-bold text-emerald-900 tabular-nums">
            {planType === "cash"
              ? eur(result.cash_total_cents)
              : `${eur(result.total_monthly_cost_cents)}/mes`}
          </div>
          {planType !== "cash" && result.deposit_cents > 0 && (
            <div className="mt-1 text-xs text-emerald-800">
              + Fianza inicial {eur(result.deposit_cents)}
            </div>
          )}
        </div>
      </div>

      {/* Ahorro */}
      {!noSavings ? (
        <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-5">
          <div className="flex items-center gap-2 text-blue-900">
            <TrendingDown className="h-6 w-6" />
            <span className="text-xs font-bold uppercase tracking-wider">
              A partir del {result.payback_years === 1 ? "primer año" : `año ${result.payback_years}`}
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-900">
            Ahorro acumulado a 5 años: {eur(result.total_saved_5y_cents)}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠ Con estos datos no hay ahorro económico claro a 10 años. Aún así, hay impacto ecológico.
        </div>
      )}

      {/* Impacto ecológico */}
      <div className="grid gap-3 sm:grid-cols-3">
        <EcoCard
          icon={Droplets}
          color="blue"
          value={`${result.bottles_saved_year.toLocaleString("es-ES")}`}
          label="Botellas evitadas/año"
        />
        <EcoCard
          icon={Leaf}
          color="emerald"
          value={`${result.co2_saved_year_kg} kg`}
          label="CO₂ evitado/año"
        />
        <EcoCard
          icon={Recycle}
          color="violet"
          value={`${result.plastic_saved_year_kg} kg`}
          label="Plástico evitado/año"
        />
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={onSave} disabled={saving} variant="success" className="gap-2">
          <Save className="h-4 w-4" /> {saving ? "Guardando…" : "Guardar propuesta"}
        </Button>
        <Button variant="outline" disabled className="gap-2">
          <Download className="h-4 w-4" /> PDF (próximamente)
        </Button>
        <Button variant="outline" disabled className="gap-2">
          <Mail className="h-4 w-4" /> Enviar por email
        </Button>
      </div>
    </div>
  );
}

function EcoCard({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: typeof Droplets;
  color: "blue" | "emerald" | "violet";
  value: string;
  label: string;
}) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
  }[color];
  return (
    <div className={`rounded-2xl border-2 p-4 ${styles}`}>
      <Icon className="h-6 w-6 mb-1" />
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
