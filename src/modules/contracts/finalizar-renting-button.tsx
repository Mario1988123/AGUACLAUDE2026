"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
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
import { finalizarRentingAction } from "./finalizar-renting-actions";

/** Botón «Finalizar renting» de la ficha de un contrato de renting en vigor. */
export function FinalizarRentingButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState("");
  const motivoOk = motivo.trim().length >= 5;

  function enviar() {
    if (!motivoOk) return;
    startTransition(async () => {
      const r = await finalizarRentingAction({ contract_id: contractId, motivo: motivo.trim() });
      if (!r.ok) {
        notify.error("No se pudo finalizar el renting", r.error);
        return;
      }
      notify.success(
        "Renting finalizado",
        `${r.equipos} equipo(s) se quedan en el cliente con mantenimiento no obligatorio.` +
          (r.mantenimientos_cancelados > 0
            ? ` Mantenimientos pendientes cancelados: ${r.mantenimientos_cancelados}.`
            : ""),
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <FileCheck2 className="h-3.5 w-3.5" />
        Finalizar renting
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar renting</DialogTitle>
            <DialogDescription>
              El contrato deja de cobrar cuotas y se cancelan sus mantenimientos pendientes. Los
              equipos pasan a «Equipo instalado» y se quedan en el cliente con mantenimiento no
              obligatorio (puedes proponerle uno desde su ficha). A partir de ahí se pueden retirar y
              el cliente se puede dar de baja. Las facturas ya emitidas no se tocan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="fr-motivo">Motivo</Label>
            <textarea
              id="fr-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ej.: fin del plazo de renting"
              className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm"
            />
            <p className="text-xs text-muted-foreground">Obligatorio. Queda en el historial del contrato.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 sm:h-9">
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={pending || !motivoOk} className="h-11 sm:h-9">
              {pending ? "Finalizando…" : "Finalizar renting"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
