"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Banknote, CalendarClock, Wrench, CheckCheck, Repeat2, Repeat } from "lucide-react";
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
  equiposParaQuedarseSafeAction,
  getFreeTrialAcceptDefaultsAction,
  type FreeTrialAcceptDefaults,
} from "./actions";

type Plan = "rental" | "cash" | "renting";
type Destino = "se_queda" | "reinstalar";

const PLAN_META: Record<Plan, { label: string; ayuda: string; icon: typeof Banknote }> = {
  rental: { label: "Alquiler", ayuda: "Esencial de pie o de sobremesa", icon: CalendarClock },
  cash: { label: "Compra", ayuda: "Al contado, cualquier equipo con precio", icon: Banknote },
  renting: { label: "Renting", ayuda: "Venta a cuotas", icon: Repeat },
};

/** Valor del selector para «el mismo equipo de la prueba». */
const MISMO = "__mismo__";

/**
 * «Se la queda» (Mario 2026-11-26). El comercial elige:
 *  1. alquiler, compra o renting (el renting es otra forma de venta);
 *  2. el equipo: el de la prueba u otro (en alquiler solo los de prueba;
 *     en compra cualquiera con precio de venta);
 *  3. qué pasa con el instalado: se queda como está, se vuelve a fijar, o
 *     —si cambia de equipo— se retira el de prueba y se instala el nuevo;
 *  4. las condiciones (se autorrellenan con los precios del equipo).
 * Crea el contrato en borrador y la orden que toque (reinstalar o retirar).
 */
export function AcceptFreeTrialButton({
  trialId,
  isProvisional = false,
}: {
  trialId: string;
  isProvisional?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState<FreeTrialAcceptDefaults | null>(null);
  const [itemsPrueba, setItemsPrueba] = useState<FreeTrialAcceptDefaults["items"]>([]);
  const [equipos, setEquipos] = useState<Array<{ id: string; nombre: string }>>([]);

  const [plan, setPlan] = useState<Plan>("rental");
  const [equipo, setEquipo] = useState<string>(MISMO);
  const [destino, setDestino] = useState<Destino>(isProvisional ? "reinstalar" : "se_queda");
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

  const cambia = equipo !== MISMO;
  const nombrePrueba = itemsPrueba.map((i) => i.name).join(", ") || "el de la prueba";
  // ¿Vale el equipo de la prueba para este plan?
  const mismoVale = useMemo(
    () =>
      itemsPrueba.length > 0 &&
      itemsPrueba.every((i) => equipos.some((e) => e.id === i.product_id)),
    [itemsPrueba, equipos],
  );

  function aplicarPrecios(d: FreeTrialAcceptDefaults, p: Plan) {
    setDefaults(d);
    setMaintPeriodicity(d.maintenance_periodicity_months || 12);
    if (p === "cash") {
      setTotalCents(d.cash_total_cents);
    } else {
      setMonthlyCents(p === "rental" ? d.rental_monthly_cents : d.renting_monthly_cents);
      const durs = p === "rental" ? d.rental_durations : d.renting_durations;
      if (durs.length) setDurationMonths(durs[durs.length - 1]!);
    }
  }

  // Al abrir: precios del equipo de la prueba.
  useEffect(() => {
    if (!open || defaults) return;
    setLoading(true);
    getFreeTrialAcceptDefaultsAction(trialId)
      .then((r) => {
        setLoading(false);
        if (!r.ok) {
          notify.error("No se pudieron cargar los precios", r.error);
          return;
        }
        setItemsPrueba(r.defaults.items);
        aplicarPrecios(r.defaults, plan);
      })
      .catch(() => {
        // Sin esto la ventana se quedaba en «Cargando…» para siempre.
        setLoading(false);
        notify.error("No se pudieron cargar los precios", "Recarga la página.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults, trialId]);

  // Equipos posibles según el plan.
  useEffect(() => {
    if (!open) return;
    equiposParaQuedarseSafeAction(plan)
      .then((r) => {
        if (!r.ok) {
          notify.error("No se pudieron cargar los equipos", r.error);
          return;
        }
        setEquipos(r.equipos);
      })
      .catch(() => notify.error("No se pudieron cargar los equipos", "Recarga la página."));
  }, [open, plan]);

  // Si el de la prueba no vale para este plan, hay que elegir otro.
  useEffect(() => {
    if (equipos.length > 0 && itemsPrueba.length > 0 && !mismoVale && equipo === MISMO) {
      setEquipo(equipos[0]!.id);
    }
  }, [equipos, itemsPrueba, mismoVale, equipo]);

  // Precios del equipo elegido.
  useEffect(() => {
    if (!open || !defaults) return;
    getFreeTrialAcceptDefaultsAction(trialId, cambia ? equipo : null)
      .then((r) => {
        if (r.ok) aplicarPrecios(r.defaults, plan);
      })
      .catch(() => {
        /* se quedan los precios anteriores; se pueden escribir a mano */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipo, plan]);

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
        charge_first_payment_now: plan === "rental" ? chargeFirstNow : false,
        maintenance_included: maintenanceIncluded,
        maintenance_periodicity_months: maintenanceIncluded ? maintPeriodicity : null,
        maintenance_months_included: maintenanceIncluded ? maintMonthsIncluded : null,
        destino_equipo: cambia ? "cambiar" : destino,
        producto_nuevo_id: cambia ? equipo : null,
      });
      if (!r.ok) {
        notify.error("No se pudo aceptar", r.error);
        return;
      }
      notify.success(
        "Se la queda",
        cambia
          ? "Contrato en borrador. Se ha pedido retirar el equipo de prueba; al firmar se crea la instalación del nuevo."
          : destino === "reinstalar"
            ? "Contrato en borrador y orden para volver a fijar el equipo."
            : "Contrato en borrador. El equipo instalado queda como definitivo.",
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
        <Check className="h-5 w-5" /> Se la queda
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Se la queda</DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando precios del equipo…</p>
          ) : (
            <div className="space-y-4">
              {/* 1. Alquiler o compra */}
              <div className="space-y-1.5">
                <Label>¿Cómo se la queda?</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PLAN_META) as Plan[]).map((p) => {
                    const Icon = PLAN_META[p].icon;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPlan(p)}
                        aria-pressed={plan === p}
                        className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border-2 p-2 text-center transition-colors ${
                          plan === p
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="text-sm font-bold">{PLAN_META[p].label}</span>
                        <span className="text-[11px] leading-tight text-muted-foreground">
                          {PLAN_META[p].ayuda}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Equipo */}
              <Field label="Equipo">
                <select
                  value={equipo}
                  onChange={(e) => setEquipo(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
                >
                  {mismoVale && <option value={MISMO}>El de la prueba ({nombrePrueba})</option>}
                  {equipos
                    .filter((e) => !(mismoVale && itemsPrueba.some((i) => i.product_id === e.id)))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        Otro: {e.nombre}
                      </option>
                    ))}
                </select>
                {!mismoVale && itemsPrueba.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {nombrePrueba} no está disponible en {PLAN_META[plan].label.toLowerCase()}: elige el equipo.
                  </p>
                )}
              </Field>

              {/* 3. Qué pasa con el equipo instalado */}
              <div className="space-y-1.5">
                <Label>Equipo de la prueba</Label>
                {cambia ? (
                  <div className="flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                    <Repeat2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      <strong>Cambio de equipo.</strong> Se pide retirar el de la prueba y, al
                      firmar el contrato, se crea la instalación del nuevo.
                    </span>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <OpcionDestino
                      activa={destino === "se_queda"}
                      onClick={() => setDestino("se_queda")}
                      icono={<CheckCheck className="h-4 w-4 text-emerald-600" aria-hidden />}
                      titulo="Se queda como está"
                      texto="La instalación ya es definitiva. No hay que volver."
                    />
                    <OpcionDestino
                      activa={destino === "reinstalar"}
                      onClick={() => setDestino("reinstalar")}
                      icono={<Wrench className="h-4 w-4 text-amber-600" aria-hidden />}
                      titulo="Se queda, pero hay que fijarlo"
                      texto="Se crea una orden de reinstalación para agendar."
                    />
                  </div>
                )}
              </div>

              {/* 4. Condiciones */}
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
                          className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
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
                  {plan === "rental" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={chargeFirstNow}
                        onChange={(e) => setChargeFirstNow(e.target.checked)}
                      />
                      Cobrar la 1ª cuota al firmar
                    </label>
                  )}
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
                <Button variant="success" onClick={submit} disabled={pending || equipos.length === 0}>
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

function OpcionDestino({
  activa,
  onClick,
  icono,
  titulo,
  texto,
}: {
  activa: boolean;
  onClick: () => void;
  icono: ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`flex w-full items-start gap-2 rounded-xl border-2 p-3 text-left transition-colors ${
        activa ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
      }`}
    >
      <span className="mt-0.5">{icono}</span>
      <span>
        <span className="block text-sm font-bold">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{texto}</span>
      </span>
    </button>
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
