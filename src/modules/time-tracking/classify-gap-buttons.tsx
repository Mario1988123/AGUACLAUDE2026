"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { classifyAttendanceGapAction } from "./attendance-gaps-actions";

// Subset de AbsenceKind permitido + dismissed. Coincide con el union
// del server action classifyAttendanceGapAction.
type Classification =
  | "vacation"
  | "sick"
  | "personal"
  | "training"
  | "other"
  | "paternity"
  | "maternity"
  | "marriage"
  | "bereavement"
  | "lactation"
  | "parental_paid_8y"
  | "parental_unpaid_8y"
  | "mudanza"
  | "civic_duty"
  | "dismissed";

const OPTIONS: Array<{ value: Classification; label: string }> = [
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
  { value: "other", label: "Otro (registrar ausencia)" },
  { value: "dismissed", label: "Descartar (no era falta)" },
];

export function ClassifyGapButtons({ gapId }: { gapId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [classification, setClassification] =
    useState<Classification>("vacation");
  const [notes, setNotes] = useState("");

  function submit() {
    startTransition(async () => {
      const r = await classifyAttendanceGapAction({
        gap_id: gapId,
        classification,
        notes: notes.trim() || undefined,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Clasificado");
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Clasificar
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 p-5">
              <h2 className="text-base font-bold">Clasificar día sin fichar</h2>
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <select
                  value={classification}
                  onChange={(e) =>
                    setClassification(e.target.value as Classification)
                  }
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notas</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={pending}
                variant="success"
              >
                {pending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
