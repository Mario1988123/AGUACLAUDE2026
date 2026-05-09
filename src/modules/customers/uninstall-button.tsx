"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createUninstallAction } from "./uninstall-actions";

interface EquipmentOption {
  id: string;
  display_name: string;
  serial_number: string | null;
  is_ours: boolean;
}

interface WarehouseOption {
  id: string;
  name: string;
  is_used_default: boolean;
}

export function UninstallEquipmentButton({
  customerId,
  equipment,
  warehouses,
}: {
  customerId: string;
  equipment: EquipmentOption[];
  warehouses: WarehouseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const ourEquipment = equipment.filter((e) => e.is_ours);
  const defaultDest =
    warehouses.find((w) => w.is_used_default)?.id ?? warehouses[0]?.id ?? "";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationId, setDestinationId] = useState(defaultDest);
  const [scheduledAt, setScheduledAt] = useState("");
  const [defaultState, setDefaultState] = useState<"used" | "damaged">("used");
  const [notes, setNotes] = useState("");

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0) {
      notify.warning("Selecciona al menos un equipo");
      return;
    }
    if (!destinationId) {
      notify.warning("Selecciona almacén destino");
      return;
    }
    startTransition(async () => {
      const r = await createUninstallAction({
        customer_id: customerId,
        equipment_ids: Array.from(selected),
        destination_warehouse_id: destinationId,
        scheduled_at: scheduledAt || null,
        default_state: defaultState,
        notes: notes || null,
      });
      if (!r.ok) {
        notify.error("No se pudo crear la desinstalación", r.error);
        return;
      }
      notify.success(
        "Orden de desinstalación creada",
        `${selected.size} equipo(s). Se completará desde /instalaciones.`,
      );
      setOpen(false);
      router.push(`/instalaciones/${r.installation_id}` as never);
    });
  }

  if (ourEquipment.length === 0 && equipment.length === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
        Desinstalar equipo
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl my-8 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-bold">Desinstalar equipo</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Crea una orden de desinstalación. Cuando el técnico la
                  cierre, los equipos suman al stock del almacén destino
                  como usados (o el estado que indiques).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Equipos a desinstalar</Label>
                {equipment.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                    Este cliente no tiene equipos activos.
                  </div>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                    {equipment.map((e) => (
                      <li key={e.id}>
                        <label className="flex items-center gap-2 rounded-lg p-2 cursor-pointer hover:bg-card">
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggle(e.id)}
                            disabled={!e.is_ours}
                            className="h-4 w-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              {e.display_name}
                              {!e.is_ours && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (externo — no se devuelve a stock)
                                </span>
                              )}
                            </div>
                            {e.serial_number && (
                              <div className="text-xs text-muted-foreground">
                                S/N: {e.serial_number}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1">
                <Label>Almacén destino</Label>
                {warehouses.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    No hay almacenes configurados.
                  </div>
                ) : (
                  <select
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.is_used_default ? " (sugerido para usados)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Estado al recoger</Label>
                  <select
                    value={defaultState}
                    onChange={(e) =>
                      setDefaultState(e.target.value as "used" | "damaged")
                    }
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    <option value="used">Usado</option>
                    <option value="damaged">Dañado</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Se podrá pasar a «reacondicionado» después desde el almacén.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Fecha sugerida (opcional)</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Notas</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                  placeholder="Motivo de la desinstalación, instrucciones para el técnico…"
                />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  Los equipos quedarán como <strong>baja</strong> en la ficha
                  del cliente cuando la instalación se complete. Esto NO
                  cancela el contrato — eso lo haces aparte si procede.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3 sticky bottom-0">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={pending || selected.size === 0 || !destinationId}
                variant="destructive"
              >
                {pending ? "Creando…" : `Desinstalar ${selected.size} equipo(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
