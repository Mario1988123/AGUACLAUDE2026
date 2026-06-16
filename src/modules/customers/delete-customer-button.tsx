"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  churnCustomerAction,
  deleteEmptyCustomerAction,
} from "./delete-flow-actions";

type Disposition = "warehouse" | "lost" | "broken" | "stolen";

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

interface Decision {
  action: "keep" | "remove";
  disposition: Disposition;
}

const DISPOSITION_LABEL: Record<Disposition, string> = {
  warehouse: "Vuelve a un almacén",
  lost: "Perdida (no se sabe dónde)",
  broken: "Rota (a la basura)",
  stolen: "Robada",
};

export function DeleteCustomerButton({
  customerId,
  equipment,
  warehouses,
  technicians,
  suggestRemove,
}: {
  customerId: string;
  equipment: EquipmentOption[];
  warehouses: WarehouseOption[];
  technicians: { user_id: string; full_name: string }[];
  /** Sugiere "retirar" por defecto (cliente con contrato de alquiler/renting). */
  suggestRemove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const hasEquipment = equipment.length > 0;
  const defaultDest =
    warehouses.find((w) => w.is_used_default)?.id ?? warehouses[0]?.id ?? "";

  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const init: Record<string, Decision> = {};
    for (const e of equipment) {
      init[e.id] = {
        action: suggestRemove ? "remove" : "keep",
        disposition: "warehouse",
      };
    }
    return init;
  });
  const [destinationId, setDestinationId] = useState(defaultDest);
  const [defaultState, setDefaultState] = useState<"used" | "damaged">("used");
  const [timing, setTiming] = useState<"already" | "schedule">("already");
  const [uninstalledAt, setUninstalledAt] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [reason, setReason] = useState("");
  const [confirmWord, setConfirmWord] = useState("");

  const removed = equipment.filter((e) => decisions[e.id]?.action === "remove");
  const anyRemove = removed.length > 0;
  const needWarehouse = removed.some(
    (e) => decisions[e.id]?.disposition === "warehouse",
  );
  const wordOk = confirmWord.trim().toLowerCase() === "borrar";

  function setAction(id: string, action: "keep" | "remove") {
    setDecisions((d) => ({ ...d, [id]: { ...d[id]!, action } }));
  }
  function setDisposition(id: string, disposition: Disposition) {
    setDecisions((d) => ({ ...d, [id]: { ...d[id]!, disposition } }));
  }

  function reset() {
    setConfirmWord("");
  }

  function submit() {
    if (!wordOk) {
      notify.warning("Escribe «borrar» para confirmar");
      return;
    }
    // Camino 1: sin equipos (creado por error)
    if (!hasEquipment) {
      startTransition(async () => {
        const r = await deleteEmptyCustomerAction({
          customer_id: customerId,
          confirm_word: confirmWord,
        });
        if (!r.ok) {
          notify.error("No se pudo borrar", r.error);
          return;
        }
        notify.success("Cliente borrado");
        setOpen(false);
        router.push("/clientes" as never);
      });
      return;
    }
    // Camino 2: con equipos
    if (anyRemove && needWarehouse && !destinationId) {
      notify.warning("Elige el almacén destino");
      return;
    }
    startTransition(async () => {
      const r = await churnCustomerAction({
        customer_id: customerId,
        confirm_word: confirmWord,
        decisions: equipment.map((e) => ({
          equipment_id: e.id,
          action: decisions[e.id]!.action,
          disposition: decisions[e.id]!.disposition,
        })),
        destination_warehouse_id: needWarehouse ? destinationId : null,
        default_state: defaultState,
        timing,
        uninstalled_at: timing === "already" ? uninstalledAt || null : null,
        technician_user_id: timing === "schedule" ? technicianId || null : null,
        scheduled_at: timing === "schedule" ? scheduledAt || null : null,
        reason: reason || null,
      });
      if (!r.ok) {
        notify.error("No se pudo dar de baja al cliente", r.error);
        return;
      }
      notify.success(
        "Cliente dado de baja",
        "Pasa a Ventas perdidas. Allí podrás borrarlo definitivamente.",
      );
      setOpen(false);
      router.push("/ventas-perdidas" as never);
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Borrar cliente
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="my-8 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-bold">Borrar cliente</h2>
                {!hasEquipment ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Este cliente no tiene equipos instalados. Se entiende que se
                    creó por error y se borrará directamente.
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Decide qué hacer con cada equipo. El cliente pasará a{" "}
                    <strong>Ventas perdidas</strong>; el borrado definitivo se
                    hace después desde allí.
                  </p>
                )}
              </div>

              {hasEquipment && (
                <>
                  {/* Decisión por equipo */}
                  <div className="space-y-2">
                    <Label>Equipos de este cliente</Label>
                    <ul className="space-y-2">
                      {equipment.map((e) => {
                        const dec = decisions[e.id]!;
                        return (
                          <li
                            key={e.id}
                            className="rounded-xl border bg-muted/20 p-2.5"
                          >
                            <div className="text-sm font-medium">
                              {e.display_name}
                              {!e.is_ours && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (externo)
                                </span>
                              )}
                            </div>
                            {e.serial_number && (
                              <div className="text-xs text-muted-foreground">
                                S/N: {e.serial_number}
                              </div>
                            )}
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <label
                                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs ${
                                  dec.action === "keep"
                                    ? "border-primary bg-primary/5"
                                    : "border-border"
                                }`}
                              >
                                <input
                                  type="radio"
                                  className="mt-0.5"
                                  checked={dec.action === "keep"}
                                  onChange={() => setAction(e.id, "keep")}
                                />
                                <span>
                                  <strong>Lo compró, se queda</strong>
                                  <br />
                                  Rechaza mantenimientos. El equipo sigue
                                  instalado.
                                </span>
                              </label>
                              <label
                                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs ${
                                  dec.action === "remove"
                                    ? "border-destructive bg-destructive/5"
                                    : "border-border"
                                }`}
                              >
                                <input
                                  type="radio"
                                  className="mt-0.5"
                                  checked={dec.action === "remove"}
                                  onChange={() => setAction(e.id, "remove")}
                                />
                                <span>
                                  <strong>Retirar la máquina</strong>
                                  <br />
                                  Alquiler / renting o fin de contrato.
                                </span>
                              </label>
                            </div>
                            {dec.action === "remove" && (
                              <div className="mt-2">
                                <Label className="text-xs">
                                  ¿Qué pasa con esta máquina?
                                </Label>
                                <select
                                  value={dec.disposition}
                                  onChange={(ev) =>
                                    setDisposition(
                                      e.id,
                                      ev.target.value as Disposition,
                                    )
                                  }
                                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                                >
                                  {(
                                    Object.keys(
                                      DISPOSITION_LABEL,
                                    ) as Disposition[]
                                  ).map((d) => (
                                    <option key={d} value={d}>
                                      {DISPOSITION_LABEL[d]}
                                    </option>
                                  ))}
                                </select>
                                {!e.is_ours &&
                                  dec.disposition === "warehouse" && (
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      Equipo externo: no suma a tu stock.
                                    </p>
                                  )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {anyRemove && (
                    <>
                      {needWarehouse && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label>Almacén destino</Label>
                            {warehouses.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                                No hay almacenes configurados.
                              </div>
                            ) : (
                              <select
                                value={destinationId}
                                onChange={(e) =>
                                  setDestinationId(e.target.value)
                                }
                                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                              >
                                {warehouses.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name}
                                    {w.is_used_default
                                      ? " (sugerido para usados)"
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label>Estado al recoger</Label>
                            <select
                              value={defaultState}
                              onChange={(e) =>
                                setDefaultState(
                                  e.target.value as "used" | "damaged",
                                )
                              }
                              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              <option value="used">Usado</option>
                              <option value="damaged">Dañado</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Momento de la retirada */}
                      <div className="space-y-2">
                        <Label>¿Cuándo se retira?</Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${
                              timing === "already"
                                ? "border-primary bg-primary/5"
                                : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              checked={timing === "already"}
                              onChange={() => setTiming("already")}
                            />
                            Ya está desinstalada
                          </label>
                          <label
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${
                              timing === "schedule"
                                ? "border-primary bg-primary/5"
                                : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              checked={timing === "schedule"}
                              onChange={() => setTiming("schedule")}
                            />
                            Programar retirada
                          </label>
                        </div>
                        {timing === "already" ? (
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Fecha de la desinstalación
                            </Label>
                            <Input
                              type="date"
                              value={uninstalledAt}
                              onChange={(e) => setUninstalledAt(e.target.value)}
                            />
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Técnico</Label>
                              <select
                                value={technicianId}
                                onChange={(e) =>
                                  setTechnicianId(e.target.value)
                                }
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
                            <div className="space-y-1">
                              <Label className="text-xs">Fecha prevista</Label>
                              <Input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(e) => setScheduledAt(e.target.value)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="space-y-1">
                    <Label>Motivo de la baja (opcional)</Label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                      placeholder="Fin de contrato, se muda, no quiere seguir…"
                    />
                  </div>
                </>
              )}

              {/* Candado de seguridad */}
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="flex-1 space-y-2">
                    <p className="text-xs text-destructive">
                      {hasEquipment
                        ? "Esta acción da de baja al cliente y lo manda a Ventas perdidas."
                        : "Esta acción borra al cliente. No se puede deshacer."}{" "}
                      Para confirmar, escribe <strong>borrar</strong>.
                    </p>
                    <Input
                      value={confirmWord}
                      onChange={(e) => setConfirmWord(e.target.value)}
                      placeholder="borrar"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={pending || !wordOk}
                variant="destructive"
              >
                {pending
                  ? "Procesando…"
                  : hasEquipment
                    ? "Dar de baja"
                    : "Borrar cliente"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
