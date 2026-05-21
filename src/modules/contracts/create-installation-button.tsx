"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Wrench,
  Plus,
  CalendarClock,
  Sun,
  Moon,
  Truck,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createInstallationFromContractSafeAction } from "@/modules/installations/actions";
import { getInstallerAvailabilityAction } from "@/modules/installations/actions";

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
const DOWS_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
    selectedDate: "" as string, // "YYYY-MM-DD"
    selectedTime: "10:00" as string, // "HH:MM"
    installer_user_id: "",
    source_warehouse_id: "",
  });

  // Cursor del calendario (mes que se muestra)
  const todayDate = new Date();
  const [cursor, setCursor] = useState({
    y: todayDate.getFullYear(),
    m: todayDate.getMonth(),
  });

  // Disponibilidad por día (count instalaciones existentes)
  const [availability, setAvailability] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    const first = new Date(cursor.y, cursor.m, 1);
    const last = new Date(cursor.y, cursor.m + 1, 0);
    void getInstallerAvailabilityAction(
      form.installer_user_id || null,
      localKey(first),
      localKey(last),
    ).then(setAvailability);
  }, [open, cursor, form.installer_user_id]);

  const visibleWarehouses = useMemo(() => {
    if (warehouses.length === 0) return [];
    if (!form.installer_user_id) {
      return warehouses;
    }
    const installerVehicle = warehouses.find(
      (w) => w.kind === "vehicle" && w.assigned_user_id === form.installer_user_id,
    );
    if (installerVehicle) return [installerVehicle];
    return warehouses.filter(
      (w) => w.kind !== "vehicle" || w.assigned_user_id == null,
    );
  }, [warehouses, form.installer_user_id]);

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
    if (!form.selectedDate || !form.selectedTime) {
      notify.warning("Selecciona fecha y hora en el calendario");
      return;
    }
    const iso = `${form.selectedDate}T${form.selectedTime}:00`;
    startTransition(async () => {
      const r = await createInstallationFromContractSafeAction({
        contract_id: contractId,
        scheduled_at: iso,
        installer_user_id: form.installer_user_id || undefined,
        source_warehouse_id: form.source_warehouse_id || undefined,
      });
      if (!r.ok) {
        notify.error("No se pudo crear la instalación", r.error);
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

  // Fechas preferidas como Set "YYYY-MM-DD"
  const preferredDateSet = new Set(preferredDates ?? []);
  // Días de semana preferidos: convertir 1-7 (1=Lun) → JS getDay (0=Dom)
  // ISO 1=Lunes ... 7=Domingo. JS: 0=Dom, 1=Lun ... 6=Sab.
  // Map: ISO -> JS = (iso === 7 ? 0 : iso)
  const preferredDowsJs = new Set(
    (preferredDaysOfWeek ?? []).map((iso) => (iso === 7 ? 0 : iso)),
  );

  const hasPreference =
    preferredSlot ||
    (preferredDaysOfWeek && preferredDaysOfWeek.length > 0) ||
    (preferredDates && preferredDates.length > 0) ||
    preferredNotes;
  const SlotIcon = (preferredSlot && SLOT_ICON[preferredSlot]) || CalendarClock;

  // Construir grid del mes (lunes=0)
  const first = new Date(cursor.y, cursor.m, 1);
  const last = new Date(cursor.y, cursor.m + 1, 0);
  const startDow = (first.getDay() + 6) % 7; // Lun=0
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = localKey(todayDate);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
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
                  <strong>{preferredDaysOfWeek.map((d) => DOWS_SHORT[d - 1]).join(", ")}</strong>
                </li>
              )}
              {preferredDates && preferredDates.length > 0 && (
                <li>
                  · Fechas concretas: en el calendario aparecen <strong>resaltadas en azul</strong>.
                </li>
              )}
              {preferredNotes && <li>· Notas: <strong>{preferredNotes}</strong></li>}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* CALENDARIO INLINE */}
          <div className="space-y-2">
            <Label>Fecha y hora *</Label>
            <div className="rounded-2xl border-2 border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    setCursor((c) => ({
                      y: c.m === 0 ? c.y - 1 : c.y,
                      m: c.m === 0 ? 11 : c.m - 1,
                    }))
                  }
                  className="rounded-lg p-1 hover:bg-muted"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-bold">
                  {MONTHS[cursor.m]} {cursor.y}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCursor((c) => ({
                      y: c.m === 11 ? c.y + 1 : c.y,
                      m: c.m === 11 ? 0 : c.m + 1,
                    }))
                  }
                  className="rounded-lg p-1 hover:bg-muted"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {DOWS_SHORT.map((d) => (
                  <span key={d} className="py-1 font-bold text-muted-foreground">
                    {d}
                  </span>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <span key={i} />;
                  const key = localKey(d);
                  const isToday = key === todayKey;
                  const isPast = key < todayKey;
                  const isPreferredDate = preferredDateSet.has(key);
                  const isPreferredDow = preferredDowsJs.has(d.getDay());
                  const isSelected = key === form.selectedDate;
                  const count = availability[key] ?? 0;

                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={isPast}
                      onClick={() => setForm((f) => ({ ...f, selectedDate: key }))}
                      className={[
                        "relative flex h-12 flex-col items-center justify-center rounded-lg text-sm transition",
                        isSelected
                          ? "bg-primary font-extrabold text-primary-foreground ring-2 ring-primary"
                          : isPreferredDate
                            ? "bg-blue-100 font-bold text-blue-900 ring-2 ring-blue-400 hover:bg-blue-200"
                            : isPreferredDow
                              ? "bg-blue-50 font-semibold text-blue-800 hover:bg-blue-100"
                              : isToday
                                ? "border-2 border-primary"
                                : "hover:bg-muted",
                        isPast && !isSelected ? "text-muted-foreground/40" : "",
                      ].join(" ")}
                      title={
                        isPreferredDate
                          ? "Fecha preferida del cliente"
                          : isPreferredDow
                            ? "Día de semana preferido del cliente"
                            : ""
                      }
                    >
                      <span>{d.getDate()}</span>
                      {form.installer_user_id && count > 0 && !isPast && (
                        <span
                          className={`absolute bottom-0.5 right-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                            count >= 3
                              ? "bg-red-500 text-white"
                              : count === 2
                                ? "bg-amber-500 text-white"
                                : "bg-emerald-500 text-white"
                          }`}
                          title={`${count} instalación(es) ya programadas este día para este instalador`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-blue-100 ring-2 ring-blue-400" /> Fecha preferida cliente
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-blue-50" /> Día semana preferido
                </span>
                {form.installer_user_id && (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-emerald-500" /> 1 inst.
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-amber-500" /> 2 inst.
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-red-500" /> 3+ inst.
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Hora */}
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-xs">Hora:</Label>
              <Input
                type="time"
                value={form.selectedTime}
                onChange={(e) =>
                  setForm({ ...form, selectedTime: e.target.value })
                }
                className="h-10 w-32"
              />
              {form.selectedDate && (
                <span className="text-xs text-muted-foreground">
                  →{" "}
                  {new Date(`${form.selectedDate}T${form.selectedTime}`).toLocaleString(
                    "es-ES",
                    {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Selecciona el día en el calendario y elige la hora. Selecciona
              instalador para ver disponibilidad por día.
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
