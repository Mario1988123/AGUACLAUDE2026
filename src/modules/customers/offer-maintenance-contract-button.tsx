"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Save, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createMaintenanceContractSafeAction } from "@/modules/maintenance-plans/actions";
import type { MaintenancePlan } from "@/modules/maintenance-plans/actions";

interface Props {
  customerId: string;
  equipmentId: string;
  equipmentName: string;
  plans: MaintenancePlan[];
}

export function OfferMaintenanceContractButton({
  customerId,
  equipmentId,
  equipmentName,
  plans,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  function fmtEur(c: number) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: "EUR",
    }).format(c / 100);
  }

  function submit() {
    if (!planId) {
      notify.warning("Selecciona un plan");
      return;
    }
    startTransition(async () => {
      const r = await createMaintenanceContractSafeAction({
        customer_id: customerId,
        customer_equipment_id: equipmentId,
        plan_id: planId,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Contrato de mantenimiento creado");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
      >
        <ShieldCheck className="h-3 w-3" />
        Ofrecer contrato
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold">
                  Contrato de mantenimiento
                </h2>
                <p className="text-xs text-muted-foreground truncate">
                  Equipo: {equipmentName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <Label>Plan</Label>
              <div className="grid gap-2">
                {plans.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${
                      planId === p.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={p.id}
                      checked={planId === p.id}
                      onChange={() => setPlanId(p.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold uppercase text-sm">
                          {p.tier}
                        </span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {fmtEur(p.monthly_cents)}/mes
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {p.visits_per_year ?? "—"} visitas/año ·{" "}
                        {p.parts_discount_percent}% dto. piezas
                        {p.spare_equipment_included ? " · equipo sustitución" : ""}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                <Save className="h-3 w-3" />
                {pending ? "Creando…" : "Crear contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
