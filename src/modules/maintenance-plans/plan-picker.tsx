"use client";

import { useState, useTransition } from "react";
import { Sparkles, Wrench, Crown, Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { createMaintenanceContractSafeAction, type MaintenancePlan } from "./actions";

const TIER_ICON = {
  lite: Wrench,
  medium: Sparkles,
  premium: Crown,
} as const;

const TIER_COLOR = {
  lite: { border: "border-slate-300", bg: "bg-slate-50", text: "text-slate-700" },
  medium: { border: "border-primary", bg: "bg-primary/5", text: "text-primary" },
  premium: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
} as const;

function fmtEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

interface Props {
  customerId: string;
  plans: MaintenancePlan[];
  /** Si viene desde una instalación, lo enlazamos */
  sourceInstallationId?: string | null;
  /** Si viene desde un contrato principal */
  sourceContractId?: string | null;
  /** Texto del botón disparador */
  buttonLabel?: string;
}

export function MaintenancePlanPicker({
  customerId,
  plans,
  sourceInstallationId,
  sourceContractId,
  buttonLabel = "Generar contrato de mantenimiento",
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    if (!selectedPlanId) {
      notify.warning("Elige un plan");
      return;
    }
    startTransition(async () => {
      const r = await createMaintenanceContractSafeAction({
        customer_id: customerId,
        plan_id: selectedPlanId,
        source_installation_id: sourceInstallationId ?? null,
        source_contract_id: sourceContractId ?? null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(
        "Contrato de mantenimiento creado",
        "Aparecerá en /mantenimientos. La remesa mensual se lanza desde ahí.",
      );
      setOpen(false);
      setSelectedPlanId(null);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="success">
        <Wrench className="h-4 w-4" /> {buttonLabel}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-card shadow-2xl sm:my-6 sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <h2 className="text-base font-bold">
                Elige plan de mantenimiento
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-3">
                {plans.map((p) => {
                  const Icon = TIER_ICON[p.tier];
                  const color = TIER_COLOR[p.tier];
                  const active = selectedPlanId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`flex flex-col gap-2 rounded-2xl border-2 p-4 text-left transition ${
                        active
                          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                          : `${color.border} ${color.bg} hover:scale-[1.02]`
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${color.text}`} />
                        <h3 className={`text-base font-extrabold ${color.text}`}>
                          {p.name}
                        </h3>
                        {p.tier === "premium" && (
                          <Badge variant="warning" className="text-[10px]">
                            Top
                          </Badge>
                        )}
                      </div>
                      <div className="text-2xl font-extrabold">
                        {fmtEur(p.monthly_cents)}
                        <span className="text-xs font-normal text-muted-foreground">
                          /mes
                        </span>
                      </div>
                      <ul className="space-y-1 text-xs">
                        <li className="flex items-start gap-1">
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                          {p.visits_per_year == null
                            ? "Visitas ILIMITADAS"
                            : `${p.visits_per_year} visita${p.visits_per_year === 1 ? "" : "s"}/año`}
                        </li>
                        <li className="flex items-start gap-1">
                          {p.parts_discount_percent > 0 ? (
                            <>
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                              {p.parts_discount_percent}% dto. en piezas
                            </>
                          ) : (
                            <>
                              <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                              Piezas a precio normal
                            </>
                          )}
                        </li>
                        <li className="flex items-start gap-1">
                          {p.spare_equipment_included ? (
                            <>
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                              Equipo de recambio incluido
                            </>
                          ) : (
                            <>
                              <X className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                              Sin equipo de recambio
                            </>
                          )}
                        </li>
                      </ul>
                      {p.description && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Se generará un contrato de mantenimiento independiente con remesa
                mensual y factura mensual contra el IBAN principal del cliente.
              </p>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                onClick={generate}
                disabled={pending || !selectedPlanId}
                variant="success"
              >
                {pending ? "Generando…" : "Generar contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
