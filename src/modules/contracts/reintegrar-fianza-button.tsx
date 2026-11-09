"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
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
import { reintegrarFianzaAction } from "./reintegrar-fianza-actions";

const eur = (c: number) =>
  (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/** Botón «Reintegrar fianza» de la ficha de un contrato finalizado. */
export function ReintegrarFianzaButton({
  contractId,
  pendienteCents,
}: {
  contractId: string;
  pendienteCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [nota, setNota] = useState("");

  function enviar() {
    startTransition(async () => {
      const r = await reintegrarFianzaAction({ contract_id: contractId, nota: nota.trim() || null });
      if (!r.ok) {
        notify.error("No se pudo reintegrar la fianza", r.error);
        return;
      }
      notify.success("Fianza reintegrada", `${eur(r.devuelto_cents)} registrados como salida de caja.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Undo2 className="h-3.5 w-3.5" />
        Reintegrar fianza
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reintegrar fianza</DialogTitle>
            <DialogDescription>
              Se devuelven al cliente <strong>{eur(pendienteCents)}</strong> de fianza. Queda
              registrado como devolución (transferencia) en los cobros del contrato y en caja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rf-nota">Nota (opcional)</Label>
            <textarea
              id="rf-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Ej.: transferencia hecha el 10-11"
              className="w-full rounded-xl border border-input bg-background p-3 text-base sm:text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="h-11 sm:h-9">
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={pending} className="h-11 sm:h-9">
              {pending ? "Reintegrando…" : `Reintegrar ${eur(pendienteCents)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
