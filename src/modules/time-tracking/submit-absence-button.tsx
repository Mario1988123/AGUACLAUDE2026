"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { submitAbsenceAction } from "./absences-actions";
import type { AbsenceKind } from "./absence-labels";

const KIND_OPTIONS: Array<{ value: AbsenceKind; label: string }> = [
  { value: "vacation", label: "Vacaciones" },
  { value: "sick", label: "Baja médica" },
  { value: "personal", label: "Asunto personal" },
  { value: "marriage", label: "Permiso matrimonio" },
  { value: "bereavement", label: "Fallecimiento familiar" },
  { value: "maternity", label: "Maternidad" },
  { value: "paternity", label: "Paternidad" },
  { value: "lactation", label: "Lactancia" },
  { value: "parental_paid_8y", label: "Parental retribuido (hasta 8 años)" },
  { value: "parental_unpaid_8y", label: "Parental no retribuido (hasta 8 años)" },
  { value: "mudanza", label: "Mudanza" },
  { value: "civic_duty", label: "Deber público" },
  { value: "training", label: "Formación" },
  { value: "other", label: "Otro" },
];

export function SubmitAbsenceButton() {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    if (!from || !to) {
      notify.warning("Indica fechas de inicio y fin");
      return;
    }
    startTransition(async () => {
      try {
        const result = await submitAbsenceAction({
          starts_on: from,
          ends_on: to,
          kind,
          notes,
        });
        if (!result.ok) {
          notify.error("No se pudo solicitar", result.error);
          return;
        }
        notify.success("Solicitud enviada al admin");
        setOpen(false);
        setFrom("");
        setTo("");
        setKind("vacation");
        setNotes("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> Solicitar ausencia
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva solicitud de ausencia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AbsenceKind)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Desde</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Hasta</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-card p-3 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending} variant="success">
                {pending ? "Enviando…" : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
