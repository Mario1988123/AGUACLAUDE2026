"use client";

import { useMemo, useState, useTransition } from "react";
import { Wrench, Plus, CalendarClock, Sun, Moon, Truck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createInstallationFromContract } from "@/modules/installations/actions";

type WarehouseLite = {
  id: string;
  name: string;
  kind: "main" | "secondary" | "vehicle" | "external_supplier";
  assigned_user_id: string | null;
};

interface Props {
  contractId: string;
  installers: { user_id: string; full_name: string }[];
  warehouses?: WarehouseLite[];
  hasInstallation: boolean;
  /** Preferencias horarias del contrato (informativas) */
  preferredSlot?: "morning" | "afternoon" | "any" | "custom" | null;
  preferredNotes?: string | null;
  preferredDaysOfWeek?: number[] | null;
  preferredDates?: string[] | null;
}

const SLOT_LABEL: Record<string, string> = {
  morning: "Mañana (9–14h)",
  afternoon: "Tarde (16–20h)",
  any: "Cualquier hora",
  custom: "Otro (ver notas)",
};
const SLOT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  morning: Sun,
  afternoon: Moon,
  any: CalendarClock,
  custom: CalendarClock,
};
const DOWS = ["L", "M", "X", "J", "V", "S", "D"];

export function CreateInstallationButton({
  contractId,
  installers,
  warehouses = [],
  hasInstallation,
  preferredSlot,
  preferredNotes,
  preferredDaysOfWeek,
  preferredDates,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    scheduled_at: "",
    installer_user_id: "",
    source_warehouse_id: "",
  });

  // Filtro inteligente de furgonetas:
  //   - Si el instalador elegido tiene asignada una furgo (warehouse.kind=
  //     'vehicle' AND assigned_user_id=installer), SOLO mostrar esa.
  //   - Si no hay ninguna furgo asignada al instalador, mostrar almacenes
  //     disponibles (main/secondary).
  //   - Si hay furgos pero ninguna del instalador, mostramos todas las
  //     furgos no asignadas + almacenes (fallback razonable).
  const visibleWarehouses = useMemo(() => {
    if (warehouses.length === 0) return [];
    if (!form.installer_user_id) {
      return warehouses;
    }
    const installerVehicle = warehouses.find(
      (w) => w.kind === "vehicle" && w.assigned_user_id === form.installer_user_id,
    );
    if (installerVehicle) return [installerVehicle];
    // Sin furgo asignada al instalador → almacenes + furgos sin dueño
    return warehouses.filter(
      (w) => w.kind !== "vehicle" || w.assigned_user_id == null,
    );
  }, [warehouses, form.installer_user_id]);

  // Auto-seleccionar la furgo del instalador en cuanto se elige
  function onChangeInstaller(uid: string) {
    setForm((f) => {
      const next = { ...f, installer_user_id: uid, source_warehouse_id: "" };
      if (uid) {
        const v = warehouses.find(
          (w) => w.kind === "vehicle" && w.assigned_user_id === uid,
        );
        if (v) next.source_warehouse_id = v.id;
      }
      return next;
    });
  }

  if (hasInstallation) {
    return (
      <p className="text-sm text-muted-foreground">
        ✓ Instalación ya generada para este contrato.
      </p>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.scheduled_at) {
      notify.warning("La fecha y hora son obligatorias para programar la instalación");
      return;
    }
    startTransition(async () => {
      try {
        await createInstallationFromContract({
          contract_id: contractId,
          scheduled_at: form.scheduled_at,
          installer_user_id: form.installer_user_id || undefined,
          source_warehouse_id: form.source_warehouse_id || undefined,
        });
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="default" className="w-full">
        <Wrench className="h-4 w-4" /> Generar instalación
      </Button>
    );
  }

  // ¿Hay alguna preferencia que mostrar?
  const hasPreference =
    preferredSlot ||
    (preferredDaysOfWeek && preferredDaysOfWeek.length > 0) ||
    (preferredDates && preferredDates.length > 0) ||
    preferredNotes;

  const SlotIcon =
    (preferredSlot && SLOT_ICON[preferredSlot]) || CalendarClock;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {hasPreference && (
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider">
              <SlotIcon className="h-3.5 w-3.5" /> Preferencia del cliente
            </div>
            <ul className="space-y-0.5">
              {preferredSlot && <li>· Franja: <strong>{SLOT_LABEL[preferredSlot]}</strong></li>}
              {preferredDaysOfWeek && preferredDaysOfWeek.length > 0 && (
                <li>
                  · Días semana:{" "}
                  <strong>{preferredDaysOfWeek.map((d) => DOWS[d - 1]).join(", ")}</strong>
                </li>
              )}
              {preferredDates && preferredDates.length > 0 && (
                <li>
                  · Fechas:{" "}
                  <strong>
                    {preferredDates
                      .map((d) =>
                        new Date(d).toLocaleDateString("es-ES", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        }),
                      )
                      .join(", ")}
                  </strong>
                </li>
              )}
              {preferredNotes && (
                <li>· Notas: <strong>{preferredNotes}</strong></li>
              )}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="when">Fecha y hora *</Label>
            <Input
              id="when"
              type="datetime-local"
              required
              value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              Obligatorio. Sin fecha no se puede programar la instalación.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="installer">Instalador</Label>
            <select
              id="installer"
              value={form.installer_user_id}
              onChange={(e) => onChangeInstaller(e.target.value)}
              className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
            >
              <option value="">Sin asignar (programar después)</option>
              {installers.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </div>
          {visibleWarehouses.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="warehouse">
                <Truck className="mr-1 inline h-3 w-3" /> Furgoneta / Almacén origen
              </Label>
              <select
                id="warehouse"
                value={form.source_warehouse_id}
                onChange={(e) => setForm({ ...form, source_warehouse_id: e.target.value })}
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="">Asignar después</option>
                {visibleWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.kind === "vehicle" ? "🚐 " : "🏭 "}
                    {w.name}
                  </option>
                ))}
              </select>
              {form.installer_user_id &&
                visibleWarehouses.length === 1 &&
                visibleWarehouses[0]!.kind === "vehicle" && (
                  <p className="text-[11px] text-emerald-700">
                    ✓ Furgoneta asignada a este instalador — se selecciona por defecto.
                  </p>
                )}
              {form.installer_user_id &&
                !warehouses.some(
                  (w) =>
                    w.kind === "vehicle" && w.assigned_user_id === form.installer_user_id,
                ) && (
                  <p className="text-[11px] text-amber-700">
                    ⚠ Este instalador no tiene furgoneta asignada. Sale del almacén
                    elegido. Si falta stock se generará una orden de carga el día de
                    la instalación.
                  </p>
                )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus className="h-4 w-4" /> {pending ? "Creando..." : "Crear instalación"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
