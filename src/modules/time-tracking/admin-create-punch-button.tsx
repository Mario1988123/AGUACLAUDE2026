"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { adminCreatePunchAction } from "./actions";
import type { PunchKind } from "./types";

interface Props {
  users: Array<{ user_id: string; full_name: string }>;
}

const KIND_OPTIONS: Array<{ value: PunchKind; label: string }> = [
  { value: "clock_in", label: "Entrada" },
  { value: "clock_out", label: "Salida" },
  { value: "break_start", label: "Inicio descanso" },
  { value: "break_end", label: "Fin descanso" },
];

export function AdminCreatePunchButton({ users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const today = new Date();
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<PunchKind>("clock_in");
  const [date, setDate] = useState(today.toISOString().slice(0, 10));
  const [time, setTime] = useState(
    `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`,
  );
  const [reason, setReason] = useState("");

  function submit() {
    if (!userId) {
      notify.warning("Selecciona usuario");
      return;
    }
    if (!date || !time) {
      notify.warning("Fecha y hora obligatorias");
      return;
    }
    if (reason.trim().length < 3) {
      notify.warning("Indica el motivo");
      return;
    }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    startTransition(async () => {
      const r = await adminCreatePunchAction({
        user_id: userId,
        punch_kind: kind,
        punched_at: iso,
        reason: reason.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Fichaje creado");
      setOpen(false);
      setUserId("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> Crear fichaje manual
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
              <h2 className="text-lg font-bold">Crear fichaje manual</h2>
              <p className="text-xs text-muted-foreground">
                Para registrar un fichaje olvidado de cualquier empleado.
                Queda marcado como manual con tu usuario y motivo.
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
                <Label>Tipo de fichaje</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PunchKind)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Hora</Label>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Motivo *</Label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. el comercial olvidó fichar la entrada"
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
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
                {pending ? "Guardando..." : "Crear fichaje"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
