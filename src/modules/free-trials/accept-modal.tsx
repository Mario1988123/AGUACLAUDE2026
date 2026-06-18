"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Banknote, CalendarClock, Repeat } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { MoneyInput } from "@/shared/components/money-input";
import { notify } from "@/shared/hooks/use-toast";
import {
  acceptFreeTrialAction,
  getFreeTrialAcceptDefaultsAction,
  type FreeTrialAcceptDefaults,
} from "./actions";

type Plan = "cash" | "rental" | "renting";

const PLAN_META: Record<Plan, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Venta (contado)", icon: Banknote },
  rental: { label: "Alquiler", icon: CalendarClock },
  renting: { label: "Renting", icon: Repeat },
};

/**
 * Botón "Aceptar — generar contrato" que abre una ventana para elegir el plan
 * (venta / alquiler / renting) y las condiciones de pago (cuota, fianza,
 * instalación, 1ª cuota, periodicidad de mantenimiento). Los importes se
 * autorrellenan desde los planes de precio del producto y son editables.
 * Al confirmar crea el contrato en borrador YA con plan y pagos.
 */
export function AcceptFreeTrialButton({ trialId }: { trialId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState<FreeTrialAcceptDefaults | null>(null);

  const [plan, setPlan] = useState<Plan>("renting");
  const [durationMonths, setDurationMonths] = useState<number>(36);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [monthlyCents, setMonthlyCents] = useState<number | null>(null);
  const [depositCents, setDepositCents] = useState<number | null>(null);
  const [installationIncluded, setInstallationIncluded] = useState(true);
  const [installationCents, setInstallationCents] = useState<number | null>(null);
  const [chargeFirstNow, setChargeFirstNow] = useState(false);
  const [maintenanceIncluded, setMaintenanceIncluded] = useState(true);
  const [maintPeriodicity, setMaintPeriodicity] = useState<number>(12);
  const [maintMonthsIncluded, setMaintMonthsIncluded] = useState<number | null>(null);

  // Cargar importes sugeridos al abrir la ventana (una sola vez).
  useEffect(() => {
    if (!open || defaults) return;
    setLoading(true);
    getFreeTrialAcceptDefaultsAction(trialId).then((r) => {
      setLoading(false);
      if (!r.ok) {
        notify.error("No se pudieron cargar los precios", r.error);
        return;
      }
      const d = r.defaults;
      setDefaults(d);
      setTotalCents(d.cash_total_cents);
      setMonthlyCents(d.renting_monthly_cents ?? d.rental_monthly_cents);
      setMaintPeriodicity(d.maintenance_periodicity_months || 12);
      if (d.renting_durations.length) {
        setDurationMonths(d.renting_durations[d.renting_durations.length - 1]!);
      }
    });
  }, [open, defaults, trialId]);

  function selectPlan(p: Plan) {
    setPlan(p);
    if (!defaults) return;
    if (p === "cash") {
      setTotalCents(defaults.cash_total_cents);
    } else {
      const monthly =
        p === "rental" ? defaults.rental_monthly_cents : defaults.renting_monthly_cents;
      setMonthlyCents(monthly);
      const durs = p === "rental" ? defaults.rental_durations : defaults.renting_durations;
      if (durs.length) setDurationMonths(durs[durs.length - 1]!);
    }
  }

  function submit() {
    if (plan === "cash" && (!totalCents || totalCents <= 0)) {
      notify.warning("Indica el precio de venta");
      return;
    }
    if (plan !== "cash" && (!monthlyCents || monthlyCents <= 0)) {
      notify.warning("Indica la cuota mensual");
      return;
    }
    if (!installationIncluded && (!installationCents || installationCents <= 0)) {
      notify.warning("Indica el coste de instalación o márcala como incluida");
      return;
    }
    startTransition(async () => {
      const r = await acceptFreeTrialAction({
        trial_id: trialId,
        plan_type: plan,
        duration_months: plan === "cash" ? null : durationMonths,
        total_cents: plan === "cash" ? totalCents : null,
        monthly_cents: plan === "cash" ? null : monthlyCents,
        deposit_cents: plan === "rental" ? depositCents : null,
        installation_cents: installationIncluded ? null : installationCents,
        charge_first_payment_now: plan !== "cash" ? chargeFirstNow : false,
        maintenance_included: maintenanceIncluded,
        maintenance_periodicity_months: maintenanceIncluded ? maintPeriodicity : null,
        maintenance_months_included: maintenanceIncluded ? maintMonthsIncluded : null,
      });
      if (!r.ok) {
        notify.error("No se pudo aceptar", r.error);
        return;
      }
      notify.success(
        "Prueba aceptada",
        "Contrato creado en borrador con el plan y los pagos. Te llevamos a la ficha.",
      );
      router.push(`/contratos/${r.contract_id}` as never);
    });
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="success"
        size="lg"
        className="w-full gap-2"
      >
        <Check className="h-5 w-5" /> Aceptar — generar contrato
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Aceptar prueba — condiciones del contrato</DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando precios del producto…</p>
          ) : (
            <div className="space-y-4">
              {/* Tipo de plan */}
              <div className="space-y-1.5">
                <Label>Tipo de plan</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PLAN_META) as Plan[]).map((p) => {
                    const Icon = PLAN_META[p].icon;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => selectPlan(p)}
                        className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs font-semibold transition-colors ${
                          plan === p
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {PLAN_META[p].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Importes según plan */}
              {plan === "cash" ? (
                <Field label="Precio de venta (€)">
                  <MoneyInput valueCents={totalCents} onChangeCents={setTotalCents} />
                </Field>
              ) : (
                <>
                  <Field label="Cuota mensual (€)">
                    <MoneyInput valueCents={monthlyCents} onChangeCents={setMonthlyCents} />
                  </Field>
                  <Field label="Duración (meses)">
                    <div className="flex flex-wrap gap-2">
                      {[12, 24, 36, 48, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDurationMonths(m)}
                          className={`rounded-lg border px-3 py-1 text-sm transition-colors ${
                            durationMonths === m
                              ? "border-primary bg-primary/10 font-semibold text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {plan === "rental" && (
                    <Field label="Fianza (€)">
                      <MoneyInput valueCents={depositCents} onChangeCents={setDepositCents} />
                    </Field>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chargeFirstNow}
                      onChange={(e) => setChargeFirstNow(e.target.checked)}
                    />
                    Cobrar la 1ª cuota al firmar
                  </label>
                </>
              )}

              {/* Instalación */}
              <div className="space-y-2 border-t pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={installationIncluded}
                    onChange={(e) => setInstallationIncluded(e.target.checked)}
                  />
                  Instalación incluida (sin coste aparte)
                </label>
                {!installationIncluded && (
                  <Field label="Coste de instalación (€)">
                    <MoneyInput
                      valueCents={installationCents}
                      onChangeCents={setInstallationCents}
                    />
                  </Field>
                )}
              </div>

              {/* Mantenimiento */}
              <div className="space-y-2 border-t pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={maintenanceIncluded}
                    onChange={(e) => setMaintenanceIncluded(e.target.checked)}
                  />
                  Mantenimiento incluido
                </label>
                {maintenanceIncluded && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Periodicidad (meses)">
                      <Input
                        type="number"
                        min={1}
                        value={maintPeriodicity}
                        onChange={(e) =>
                          setMaintPeriodicity(
                            Math.max(1, parseInt(e.target.value || "12", 10) || 12),
                          )
                        }
                      />
                    </Field>
                    <Field label="Meses incluidos (opcional)">
                      <Input
                        type="number"
                        min={0}
                        value={maintMonthsIncluded ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const v = e.target.value;
                          setMaintMonthsIncluded(v ? Math.max(0, parseInt(v, 10) || 0) : null);
                        }}
                      />
                    </Field>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button variant="success" onClick={submit} disabled={pending}>
                  {pending ? "Procesando…" : "Crear contrato"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
