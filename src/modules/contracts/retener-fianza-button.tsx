"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
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
import { MOTIVO_RETENCION_MIN } from "./fianza-logica";
import { retenerFianzaAction } from "./reintegrar-fianza-actions";

const eur = (c: number) =>
  (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/** Botón «Nos la quedamos» (retener la fianza pendiente). */
export function RetenerFianzaButton({
  contractId,
  pendienteCents,
}: {
  contractId: string;
  pendienteCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [motivo, setMotivo] = useState("");
  const motivoOk = motivo.trim().length >= MOTIVO_RETENCION_MIN;

  function enviar() {
    if (!motivoOk) return;
    startTransition(async () => {
      const r = await retenerFianzaAction({ contract_id: contractId, motivo: motivo.trim() });
      if (!r.ok) {
        notify.error("No se pudo retener la fianza", r.error);
        return;
      }
      notify.success("Fianza retenida", `${eur(r.retenido_cents)} quedan como retención.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Lock className="h-3.5 w-3.5" />
        Nos la quedamos
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retener la fianza</DialogTitle>
            <DialogDescription>
              La empresa se queda <strong>{eur(pendienteCents)}</strong> de fianza. Queda registrado
              como retención en los cobros del contrato; no hay movimiento de caja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rt-motivo">Motivo</Label>
            <textarea
              id="rt-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Ej.: equipo devuelto con desperfectos"
              className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm"
            />
            <p className="text-xs text-muted-foreground">Obligatorio. Queda en el historial del contrato.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 sm:h-9">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={enviar} disabled={pending || !motivoOk} className="h-11 sm:h-9">
              {pending ? "Guardando…" : `Retener ${eur(pendienteCents)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
