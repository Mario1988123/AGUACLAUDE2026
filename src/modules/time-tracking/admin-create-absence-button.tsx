"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { adminCreateAbsenceAction } from "./leave-budget-actions";
import { ABSENCE_KIND_LABEL_UC, type AbsenceKind } from "./absence-labels";

interface Props {
  users: Array<{ user_id: string; full_name: string }>;
}

const KIND_OPTIONS: AbsenceKind[] = [
  "vacation",
  "sick",
  "personal",
  "marriage",
  "bereavement",
  "maternity",
  "paternity",
  "lactation",
  "parental_paid_8y",
  "parental_unpaid_8y",
  "mudanza",
  "civic_duty",
  "training",
  "other",
];

export function AdminCreateAbsenceButton({ users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");

  function submit() {
    if (!userId) {
      notify.warning("Selecciona empleado");
      return;
    }
    if (!from || !to) {
      notify.warning("Indica fechas");
      return;
    }
    startTransition(async () => {
      const r = await adminCreateAbsenceAction({
        user_id: userId,
        kind,
        starts_on: from,
        ends_on: to,
        notes: notes.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudo registrar", r.error);
        return;
      }
      notify.success(
        "Ausencia registrada",
        "Aprobada directamente. El empleado ha sido notificado.",
      );
      setOpen(false);
      setUserId("");
      setKind("vacation");
      setFrom("");
      setTo("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> Registrar ausencia
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-lg font-bold">Registrar ausencia</h2>
              <p className="text-xs text-muted-foreground">
                Sin necesidad de petición del empleado. Queda aprobada
                directamente, descontando del balance si aplica.
              </p>
              <div className="space-y-1.5">
                <Label>Empleado</Label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Selecciona —</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AbsenceKind)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {ABSENCE_KIND_LABEL_UC[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Desde</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Hasta</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notas</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
                  placeholder="Ej. baja por gripe presentada con parte médico"
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending} variant="success">
                {pending ? "Guardando..." : "Registrar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
