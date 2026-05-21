"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createMaintenanceSafeAction } from "@/modules/maintenance/actions";

interface EquipmentLite {
  id: string;
  display_name: string;
}
interface TechnicianLite {
  user_id: string;
  full_name: string;
}

export function CreateMaintenanceButton({
  customerId,
  equipment,
  technicians,
}: {
  customerId: string;
  equipment: EquipmentLite[];
  technicians: TechnicianLite[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [equipmentId, setEquipmentId] = useState(equipment[0]?.id ?? "");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [kind, setKind] = useState<"contracted" | "one_off" | "warranty">(
    "one_off",
  );
  const [isCharged, setIsCharged] = useState(false);
  const [chargeEur, setChargeEur] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    startTransition(async () => {
      const r = await createMaintenanceSafeAction({
        customer_id: customerId,
        customer_equipment_id: equipmentId || undefined,
        kind,
        scheduled_at: new Date(scheduledAt).toISOString(),
        technician_user_id: technicianId || undefined,
        is_charged: isCharged,
        charge_cents:
          isCharged && chargeEur
            ? Math.round(Number(chargeEur.replace(",", ".")) * 100)
            : null,
        notes,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Mantenimiento creado");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        <Wrench className="h-3.5 w-3.5" /> Crear mantenimiento
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <h2 className="text-lg font-bold">
                Crear mantenimiento manual
              </h2>
              <div className="space-y-1">
                <Label>Equipo (opcional)</Label>
                <select
                  value={equipmentId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Sin equipo concreto —</option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as "contracted" | "one_off" | "warranty")
                    }
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="one_off">Correctivo (entre revisiones)</option>
                    <option value="contracted">Incluido en contrato</option>
                    <option value="warranty">Garantía del fabricante</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Técnico</Label>
                  <select
                    value={technicianId}
                    onChange={(e) => setTechnicianId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— Sin asignar —</option>
                    {technicians.map((t) => (
                      <option key={t.user_id} value={t.user_id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Fecha programada</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 rounded-xl border bg-muted/30 p-2">
                <input
                  type="checkbox"
                  checked={isCharged}
                  onChange={(e) => setIsCharged(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">Cobrable al cliente</span>
              </label>
              {isCharged && (
                <div className="space-y-1">
                  <Label>Importe (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={chargeEur}
                    onChange={(e) => setChargeEur(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>Notas</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                {pending ? "Creando…" : "Crear mantenimiento"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
