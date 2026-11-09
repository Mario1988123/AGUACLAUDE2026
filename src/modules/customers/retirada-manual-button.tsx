"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageX, AlertTriangle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { madridDateKey } from "@/shared/lib/format-date";
import {
  ERROR_RENTING,
  ESTADO_EQUIPO_LABEL,
  MOTIVO_MIN,
  type DestinoEquipo,
  type EstadoEquipoRetirado,
} from "./retirada-logica";
import { retirarEquipoManualAction } from "./retirada-manual-actions";
import { notificarResultadoRetirada } from "./retirada-resultado";

interface EquipoOpcion {
  id: string;
  display_name: string;
  serial_number: string | null;
  /** Equipo nuestro (con producto del catálogo): puede volver a stock. */
  is_ours: boolean;
  /** En renting: no se puede retirar (Mario 2026-11-09). */
  en_renting?: boolean;
}

interface AlmacenOpcion {
  id: string;
  name: string;
  is_used_default: boolean;
}

const DESTINO_LABEL: Record<DestinoEquipo, string> = {
  warehouse: "Vuelve al almacén",
  lost: "Perdido",
  broken: "Roto (se tira)",
  stolen: "Robado",
  not_ours: "No vuelve al almacén (no es nuestro / era de otra empresa)",
};

const SELECT_CLS =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-base sm:h-10 sm:text-sm";

/**
 * Botón "Retirar manualmente": da de baja uno o varios equipos del cliente
 * YA retirados en la realidad (o devueltos en tienda) sin agendar nada. Mismos
 * efectos que cerrar una orden de desinstalación. Solo se pinta para
 * admin / director técnico (lo decide la página; la acción lo vuelve a
 * comprobar en el servidor).
 */
export function RetiradaManualButton({
  customerId,
  equipment,
  warehouses,
}: {
  customerId: string;
  equipment: EquipoOpcion[];
  warehouses: AlmacenOpcion[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const hoy = useMemo(() => madridDateKey(new Date()), []);
  const almacenPorDefecto =
    warehouses.find((w) => w.is_used_default)?.id ?? warehouses[0]?.id ?? "";

  const [seleccion, setSeleccion] = useState<Set<string>>(
    () => {
      const retirables = equipment.filter((e) => !e.en_renting);
      return new Set(retirables.length === 1 ? [retirables[0]!.id] : []);
    },
  );
  const [destinos, setDestinos] = useState<Record<string, DestinoEquipo>>({});
  const [fecha, setFecha] = useState(hoy);
  const [almacenId, setAlmacenId] = useState(almacenPorDefecto);
  const [estado, setEstado] = useState<EstadoEquipoRetirado>("operative");
  const [motivo, setMotivo] = useState("");

  if (equipment.length === 0) return null;

  const destinoDe = (id: string): DestinoEquipo => destinos[id] ?? "warehouse";
  const elegidos = equipment.filter((e) => seleccion.has(e.id));
  const vuelveStock = elegidos.some((e) => e.is_ours && destinoDe(e.id) === "warehouse");
  const motivoOk = motivo.trim().length >= MOTIVO_MIN;
  const fechaOk = !!fecha && fecha <= hoy;
  const puedeEnviar =
    !pending && elegidos.length > 0 && motivoOk && fechaOk && (!vuelveStock || !!almacenId);

  function alternar(id: string) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function enviar() {
    if (!puedeEnviar) return;
    startTransition(async () => {
      const r = await retirarEquipoManualAction({
        customer_id: customerId,
        equipment_ids: elegidos.map((e) => e.id),
        fecha_retirada: fecha,
        destination_warehouse_id: vuelveStock ? almacenId : null,
        estado_equipo: estado,
        motivo: motivo.trim(),
        destinos: elegidos.map((e) => ({
          equipment_id: e.id,
          destino: e.is_ours ? destinoDe(e.id) : ("not_ours" as DestinoEquipo),
        })),
      });
      if (!r.ok) {
        notify.error("No se pudo retirar el equipo", r.error);
        return;
      }
      notificarResultadoRetirada(r);
      setOpen(false);
      setMotivo("");
      setSeleccion(new Set());
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <PackageX className="h-3.5 w-3.5 text-destructive" />
        Retirar manualmente
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="gap-5">
          <DialogHeader>
            <DialogTitle>Retirar equipo manualmente</DialogTitle>
            <DialogDescription>
              Para equipos que ya no están en el cliente: se retiraron o los devolvió en tienda.
              No se crea tarea ni cita; se da de baja ahora con la fecha que indiques.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Equipos</legend>
            <ul className="space-y-2">
              {equipment.map((e) => {
                const marcado = seleccion.has(e.id);
                return (
                  <li key={e.id} className="rounded-xl border bg-muted/20 p-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(e.id)}
                        disabled={!!e.en_renting}
                        className="h-5 w-5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium break-words">
                          {e.display_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {e.serial_number ? `S/N ${e.serial_number}` : "Sin número de serie"}
                          {!e.is_ours && " · externo"}
                        </span>
                        {e.en_renting && (
                          <span className="mt-0.5 block text-xs font-medium text-destructive">
                            {ERROR_RENTING}
                          </span>
                        )}
                      </span>
                    </label>
                    {marcado && !e.is_ours && (
                      <p className="mt-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                        {DESTINO_LABEL.not_ours}
                      </p>
                    )}
                    {marcado && e.is_ours && (
                      <select
                        aria-label={`Destino de ${e.display_name}`}
                        value={destinoDe(e.id)}
                        onChange={(ev) =>
                          setDestinos((d) => ({ ...d, [e.id]: ev.target.value as DestinoEquipo }))
                        }
                        className={`${SELECT_CLS} mt-2`}
                      >
                        {(Object.keys(DESTINO_LABEL) as DestinoEquipo[]).map((k) => (
                          <option key={k} value={k}>
                            {DESTINO_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rm-fecha">Fecha de retirada</Label>
              <Input
                id="rm-fecha"
                type="date"
                value={fecha}
                max={hoy}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 text-base sm:h-10 sm:text-sm"
              />
              {!fechaOk && (
                <p className="text-xs text-destructive">No puede ser una fecha futura.</p>
              )}
            </div>
            {vuelveStock && (
              <div className="space-y-1.5">
                <Label htmlFor="rm-estado">Estado del equipo</Label>
                <select
                  id="rm-estado"
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as EstadoEquipoRetirado)}
                  className={SELECT_CLS}
                >
                  {(Object.keys(ESTADO_EQUIPO_LABEL) as EstadoEquipoRetirado[]).map((k) => (
                    <option key={k} value={k}>
                      {ESTADO_EQUIPO_LABEL[k]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {estado === "operative"
                    ? "Entra al almacén como usado."
                    : estado === "damaged"
                      ? "Entra como dañado."
                      : "Entra como dañado con la marca «para revisar»."}
                </p>
              </div>
            )}
          </div>

          {vuelveStock && (
            <div className="space-y-1.5">
              <Label htmlFor="rm-almacen">Almacén de destino</Label>
              {warehouses.length === 0 ? (
                <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  No hay almacenes configurados. Crea uno o marca el equipo como perdido, roto o
                  robado.
                </p>
              ) : (
                <select
                  id="rm-almacen"
                  value={almacenId}
                  onChange={(e) => setAlmacenId(e.target.value)}
                  className={SELECT_CLS}
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rm-motivo">Motivo</Label>
            <textarea
              id="rm-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ej.: el cliente lo devolvió en tienda el lunes"
              className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Obligatorio. Queda en el historial del cliente junto a quién lo registró.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              El equipo queda de <strong>baja</strong> y, si vuelve al almacén, suma al stock.
              Se <strong>deja de cobrar</strong>: se finaliza su contrato de alquiler o renting (si
              no cubre otros equipos) y se cancelan sus mantenimientos pendientes. Las facturas
              ya emitidas no se tocan.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={enviar}
              disabled={!puedeEnviar}
              className="h-11 sm:h-9"
            >
              {pending
                ? "Retirando…"
                : elegidos.length > 1
                  ? `Retirar ${elegidos.length} equipos`
                  : "Retirar equipo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
