"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PackageMinus, Calendar } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { scheduleFreeTrialUninstallAction } from "./uninstall-actions";

export interface WarehouseOption {
  id: string;
  name: string;
  is_used_default: boolean;
}
export interface InstallerOption {
  user_id: string;
  full_name: string;
}

export function ScheduleUninstallButton({
  trialId,
  warehouses,
  installers,
  reason,
}: {
  trialId: string;
  warehouses: WarehouseOption[];
  installers: InstallerOption[];
  /** "rejected" | "expired" | "manual" — solo informativo en UI */
  reason?: "rejected" | "expired" | "manual";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const defaultWh = warehouses.find((w) => w.is_used_default) ?? warehouses[0];
  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? "");
  const [installerId, setInstallerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [state, setState] = useState<"used" | "damaged">("used");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!warehouseId) {
      notify.warning("Selecciona el almacén destino");
      return;
    }
    startTransition(async () => {
      const r = await scheduleFreeTrialUninstallAction({
        trial_id: trialId,
        destination_warehouse_id: warehouseId,
        scheduled_at: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
        installer_user_id: installerId || null,
        default_state: state,
        notes: notes || null,
      });
      if (!r.ok) {
        notify.error("No se pudo agendar", r.error);
        return;
      }
      notify.success(
        "Desinstalación agendada",
        `Orden ${r.reference_code} creada. Cuando se complete, la prueba pasará a «retirada».`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (warehouses.length === 0) {
    return (
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        Para agendar una desinstalación, primero crea al menos un almacén en{" "}
        <Link href="/almacenes" className="font-bold underline">
          /almacenes
        </Link>{" "}
        (lo ideal: uno marcado como destino por defecto de equipos usados).
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => setOpen(true)}
      >
        <PackageMinus className="h-4 w-4" />
        Agendar desinstalación
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agendar retirada del equipo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Se creará una orden de <strong>desinstalación</strong> en el
              módulo de instalaciones. Cuando el técnico complete la retirada,
              la prueba pasará automáticamente a «retirada» y el stock volverá
              al almacén destino con el estado indicado.
              {reason === "expired" && (
                <>
                  {" "}
                  La prueba está <strong>caducada</strong> sin aceptarse.
                </>
              )}
              {reason === "rejected" && (
                <>
                  {" "}
                  La prueba ha sido <strong>rechazada</strong> por el cliente.
                </>
              )}
            </p>

            <div className="space-y-1.5">
              <Label>Almacén destino *</Label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Elegir —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.is_used_default ? " · destino por defecto" : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                El equipo entrará en stock como{" "}
                <strong>{state === "damaged" ? "DAÑADO" : "USADO"}</strong>.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Fecha programada</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  min={(() => {
                    const d = new Date();
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    return d.toISOString().slice(0, 16);
                  })()}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Si la dejas en blanco queda sin agendar — el director técnico
                  la colocará desde la agenda.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Técnico</Label>
                <select
                  value={installerId}
                  onChange={(e) => setInstallerId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Asignar luego —</option>
                  {installers.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Estado de retorno</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setState("used")}
                  className={`flex-1 rounded-xl border-2 p-2 text-sm font-semibold ${
                    state === "used"
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  Usado (re-vendible)
                </button>
                <button
                  type="button"
                  onClick={() => setState("damaged")}
                  className={`flex-1 rounded-xl border-2 p-2 text-sm font-semibold ${
                    state === "damaged"
                      ? "border-destructive bg-destructive/5"
                      : "border-border bg-card hover:border-destructive/40"
                  }`}
                >
                  Dañado
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                placeholder="Indicaciones para el técnico..."
              />
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={pending || !warehouseId}
                variant="success"
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                {pending ? "Creando..." : "Crear orden"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
