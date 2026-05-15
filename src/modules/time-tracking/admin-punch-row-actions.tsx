"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { editPunchAction, adminDeletePunchAction } from "./actions";

interface Props {
  punchId: string;
  /** ISO actual del fichaje, en zona horaria local del navegador. */
  currentPunchedAt: string;
  /** Etiqueta para confirmaciones, p.ej. "Entrada · Mario · 15/05/26 09:30". */
  contextLabel: string;
}

function isoToLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${h}:${min}` };
}

export function AdminPunchRowActions({
  punchId,
  currentPunchedAt,
  contextLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);

  const init = isoToLocalInputs(currentPunchedAt);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [editReason, setEditReason] = useState("");
  const [delReason, setDelReason] = useState("");

  function doEdit() {
    if (!date || !time) {
      notify.warning("Fecha y hora obligatorias");
      return;
    }
    if (editReason.trim().length < 3) {
      notify.warning("Indica el motivo");
      return;
    }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    startTransition(async () => {
      const r = await editPunchAction({
        punch_id: punchId,
        punched_at: iso,
        reason: editReason.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo editar", r.error);
        return;
      }
      notify.success("Fichaje editado");
      setEditOpen(false);
      setEditReason("");
      router.refresh();
    });
  }

  function doDelete() {
    if (delReason.trim().length < 3) {
      notify.warning("Indica el motivo");
      return;
    }
    startTransition(async () => {
      const r = await adminDeletePunchAction(punchId, delReason.trim());
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      notify.success("Fichaje eliminado");
      setDelOpen(false);
      setDelReason("");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
          title="Editar fichaje"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setDelOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Eliminar fichaje"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Modal Editar */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => !pending && setEditOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              <h2 className="text-lg font-bold">Editar fichaje</h2>
              <p className="text-xs text-muted-foreground">{contextLabel}</p>
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
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. corrección por error de minutos"
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={doEdit} disabled={pending} variant="success">
                {pending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Eliminar */}
      {delOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setDelOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 p-5">
              <h2 className="text-lg font-bold">Eliminar fichaje</h2>
              <p className="text-xs text-muted-foreground">{contextLabel}</p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                ⚠ Esta acción no se puede deshacer. Se registra en el log
                quién y por qué.
              </div>
              <div className="space-y-1.5">
                <Label>Motivo *</Label>
                <textarea
                  value={delReason}
                  onChange={(e) => setDelReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. fichaje duplicado por error"
                  className="w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setDelOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={doDelete} disabled={pending} variant="destructive">
                {pending ? "Eliminando..." : "Eliminar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
