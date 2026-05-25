"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, CheckCircle2, X, Heart, PhoneOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  completeMaintenanceSafeAction,
  isLastContractedMaintenance,
  acceptRenewalAction,
  declineRenewalAction,
} from "./actions";

interface ProductOpt {
  id: string;
  name: string;
}

interface MaintenancePlanOpt {
  id: string;
  name: string;
  tier: string;
  monthly_cents: number;
}

interface ReplaceItem {
  product_id: string;
  quantity: number;
}

export function MaintenanceCompleteForm({
  maintenanceId,
  products,
  maintenancePlans,
}: {
  maintenanceId: string;
  products: ProductOpt[];
  /** Planes de mantenimiento disponibles — usados si la visita actual
   *  es la última del contrato y el técnico quiere ofrecer renovación. */
  maintenancePlans?: MaintenancePlanOpt[];
}) {
  const [items, setItems] = useState<ReplaceItem[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  // Estado del modal de renovación post-cierre.
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [renewalContractId, setRenewalContractId] = useState<string | null>(null);
  const [renewalEquipmentId, setRenewalEquipmentId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const plans = maintenancePlans ?? [];

  function addItem() {
    if (products.length === 0) return;
    setItems((prev) => [...prev, { product_id: products[0]!.id, quantity: 1 }]);
  }

  function updateItem(idx: number, patch: Partial<ReplaceItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    startTransition(async () => {
      const res = await completeMaintenanceSafeAction({
        id: maintenanceId,
        notes: notes || undefined,
        replaced_items: items,
      });
      if (!res.ok) {
        notify.error("No se pudo completar", res.error);
        return;
      }
      notify.success("Mantenimiento completado");
      const r = await isLastContractedMaintenance(maintenanceId);
      if (r.isLast && r.contract_id && plans.length > 0) {
        setRenewalContractId(r.contract_id);
        setRenewalEquipmentId(r.customer_equipment_id);
        setRenewalOpen(true);
        return;
      }
      location.reload();
    });
  }

  function acceptRenewal() {
    if (!renewalContractId || !selectedPlanId) {
      notify.warning("Selecciona un plan de mantenimiento");
      return;
    }
    startTransition(async () => {
      const r = await acceptRenewalAction({
        contract_id: renewalContractId,
        maintenance_plan_id: selectedPlanId,
        // Contrato POR EQUIPO (regla 2026-05-25)
        customer_equipment_id: renewalEquipmentId,
      });
      if (!r.ok) {
        notify.error("No se pudo registrar la renovación", r.error);
        return;
      }
      notify.success(
        "Contrato de mantenimiento creado",
        "Se generará la remesa mensual y los próximos mantenimientos.",
      );
      location.reload();
    });
  }

  function declineRenewal() {
    if (!renewalContractId) return;
    startTransition(async () => {
      const r = await declineRenewalAction({ contract_id: renewalContractId });
      if (!r.ok) {
        notify.error("No se pudo registrar el rechazo", r.error);
        return;
      }
      notify.success(
        "Rechazo registrado",
        "Hemos programado una llamada de seguimiento para dentro de 30 días.",
      );
      location.reload();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold uppercase tracking-wide">Recambios</Label>
          <Button variant="outline" size="sm" onClick={addItem} type="button">
            <Plus className="h-4 w-4" /> Añadir
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Añade los productos consumidos. Se descontarán del stock automáticamente.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Producto</Label>
                  <select
                    value={it.product_id}
                    onChange={(e) => updateItem(idx, { product_id: e.target.value })}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 space-y-1.5">
                  <Label className="text-xs">Cant.</Label>
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="h-12 w-12 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Notas del técnico</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          placeholder="Observaciones, estado del equipo, etc."
        />
      </div>

      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        <CheckCircle2 className="h-5 w-5" />
        {pending ? "Guardando..." : "Completar mantenimiento"}
      </Button>

      {/* Modal de renovación: aparece tras cerrar la ÚLTIMA visita del
          contrato. El técnico ofrece al cliente seguir con un contrato
          de mantenimiento independiente. Si acepta → remesa mensual.
          Si rechaza → llamada programada al TMK en 30 días. */}
      {renewalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3"
          onClick={() => setRenewalOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b p-4">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Heart className="h-4 w-4 text-pink-500" />
                  Última visita del contrato
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Esta era la última revisión incluida. ¿Quieres ofrecer al
                  cliente un contrato de mantenimiento independiente para
                  seguir cuidando su equipo?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRenewalOpen(false)}
                className="rounded-full p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-2">
                <Label>Plan a ofrecer</Label>
                <div className="grid gap-2">
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`rounded-xl border-2 p-3 text-left transition ${
                        selectedPlanId === p.id
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-bold">{p.name}</span>
                        <span className="font-mono text-sm">
                          {(p.monthly_cents / 100).toFixed(2)} €/mes
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground uppercase">
                        Tier {p.tier}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                <strong>Si el cliente acepta</strong>: se crea un contrato de
                mantenimiento activo y se genera remesa mensual automática.
                <br />
                <strong>Si rechaza</strong>: programamos una llamada de
                seguimiento al TMK en 30 días.
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-3">
              <Button
                variant="outline"
                onClick={declineRenewal}
                disabled={pending}
                className="gap-1.5"
              >
                <PhoneOff className="h-4 w-4" />
                Rechaza · programar llamada
              </Button>
              <Button
                variant="success"
                onClick={acceptRenewal}
                disabled={pending || !selectedPlanId}
                className="gap-1.5"
              >
                <Heart className="h-4 w-4" />
                Acepta · crear contrato
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
