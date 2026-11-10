"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageX } from "lucide-react";
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
  ESTADO_EQUIPO_LABEL,
  MOTIVO_MIN,
  type EstadoEquipoRetirado,
} from "./retirada-logica";
import { retirarPruebaManualAction } from "./retirada-prueba-actions";
import { notificarResultadoRetirada } from "./retirada-resultado";

const CAMPO_CLS =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-base sm:h-10 sm:text-sm";

/**
 * "Retirar manualmente" en la ficha de una prueba gratuita: el equipo ya no
 * está en casa del cliente y se registra sin agendar. La prueba pasa a
 * Retirada y el stock vuelve al almacén elegido. Solo se pinta para admin /
 * director técnico (la acción lo vuelve a comprobar).
 */
export function RetiradaPruebaButton({
  trialId,
  warehouses,
  hayRetiradaProgramada,
}: {
  trialId: string;
  warehouses: Array<{ id: string; name: string; is_used_default: boolean }>;
  hayRetiradaProgramada: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const hoy = useMemo(() => madridDateKey(new Date()), []);
  const [fecha, setFecha] = useState(hoy);
  const [almacenId, setAlmacenId] = useState(
    warehouses.find((w) => w.is_used_default)?.id ?? warehouses[0]?.id ?? "",
  );
  const [estado, setEstado] = useState<EstadoEquipoRetirado>("operative");
  const [motivo, setMotivo] = useState("");

  const fechaOk = !!fecha && fecha <= hoy;
  const puedeEnviar = !pending && fechaOk && !!almacenId && motivo.trim().length >= MOTIVO_MIN;

  function enviar() {
    if (!puedeEnviar) return;
    startTransition(async () => {
      const r = await retirarPruebaManualAction({
        trial_id: trialId,
        fecha_retirada: fecha,
        destination_warehouse_id: almacenId,
        estado_equipo: estado,
        motivo: motivo.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo retirar la prueba", r.error);
        return;
      }
      notificarResultadoRetirada(r);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-11 w-full gap-1.5 sm:h-9"
      >
        <PackageX className="h-4 w-4 text-destructive" />
        Retirar manualmente
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="gap-5">
          <DialogHeader>
            <DialogTitle>Retirar prueba manualmente</DialogTitle>
            <DialogDescription>
              El equipo ya no está en casa del cliente (se retiró o lo devolvió en tienda). No se
              crea tarea ni cita: la prueba pasa a Retirada y el equipo vuelve al almacén.
            </DialogDescription>
          </DialogHeader>

          {hayRetiradaProgramada && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Hay una retirada programada: se cancelará y la sustituye esta.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-fecha">Fecha de retirada</Label>
              <Input
                id="rp-fecha"
                type="date"
                value={fecha}
                max={hoy}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 text-base sm:h-10 sm:text-sm"
              />
              {!fechaOk && <p className="text-xs text-destructive">No puede ser una fecha futura.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-estado">Estado del equipo</Label>
              <select
                id="rp-estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoEquipoRetirado)}
                className={CAMPO_CLS}
              >
                {(Object.keys(ESTADO_EQUIPO_LABEL) as EstadoEquipoRetirado[]).map((k) => (
                  <option key={k} value={k}>
                    {ESTADO_EQUIPO_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-almacen">Almacén de destino</Label>
            {warehouses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                No hay almacenes configurados.
              </p>
            ) : (
              <select
                id="rp-almacen"
                value={almacenId}
                onChange={(e) => setAlmacenId(e.target.value)}
                className={CAMPO_CLS}
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

          <div className="space-y-1.5">
            <Label htmlFor="rp-motivo">Motivo</Label>
            <textarea
              id="rp-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ej.: no la quiere y la trajo a la tienda"
              className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Obligatorio. Queda en el historial de la prueba junto a quién lo registró.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 sm:h-9">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={enviar} disabled={!puedeEnviar} className="h-11 sm:h-9">
              {pending ? "Retirando…" : "Retirar prueba"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
