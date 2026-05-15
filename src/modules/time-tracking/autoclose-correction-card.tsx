"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createPunchRequestAction } from "./punch-requests-actions";

interface Props {
  items: Array<{
    id: string;
    punched_at: string;
    has_pending_correction: boolean;
  }>;
}

export function AutocloseCorrectionCard({ items }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");

  const pending_items = items.filter((i) => !i.has_pending_correction);
  if (pending_items.length === 0) return null;

  function openModal(itemId: string, suggestedTime: string) {
    setOpen(itemId);
    setTime(suggestedTime);
    setReason("");
  }

  function submit(item: Props["items"][number]) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      notify.warning("Formato hora: HH:MM");
      return;
    }
    if (reason.trim().length < 3) {
      notify.warning("Indica el motivo (ej. horas extras)");
      return;
    }
    const datePart = item.punched_at.slice(0, 10);
    const iso = new Date(`${datePart}T${time}:00`).toISOString();
    startTransition(async () => {
      try {
        await createPunchRequestAction({
          requested_at: iso,
          punch_kind: "clock_out",
          reason: reason.trim(),
        });
        notify.success(
          "Solicitud enviada",
          "El admin validará la hora real propuesta.",
        );
        setOpen(null);
        setTime("");
        setReason("");
        router.refresh();
      } catch (err) {
        notify.error(
          "Error",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-amber-900">
            Fichajes cerrados automáticamente
          </h3>
          <p className="text-xs text-amber-800">
            El sistema cerró tu jornada por inactividad. Si la hora real
            es diferente (por ejemplo, hiciste horas extras), proponla y
            el admin la validará.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {pending_items.map((it) => {
          const dt = new Date(it.punched_at);
          const dateLabel = dt.toLocaleDateString("es-ES", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
          const timeLabel = dt.toLocaleTimeString("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Madrid",
          });
          const suggestedTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
          return (
            <li
              key={it.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white/60 p-2 text-sm"
            >
              <div>
                <div className="font-semibold capitalize">{dateLabel}</div>
                <div className="text-xs text-muted-foreground">
                  Cerrado automático: <strong>{timeLabel}</strong>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openModal(it.id, suggestedTime)}
              >
                Indicar hora real
              </Button>
            </li>
          );
        })}
      </ul>

      {/* Modal corrección */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-3">
              <h3 className="font-bold">Corregir hora de salida</h3>
              <button
                onClick={() => setOpen(null)}
                className="rounded-full p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Hora real de salida</Label>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Indica la hora exacta a la que terminaste, aunque sea
                  más tarde del fin de turno.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Motivo *</Label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Ej. horas extras por urgencia en cliente"
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(null)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={() => {
                  const it = pending_items.find((x) => x.id === open);
                  if (it) submit(it);
                }}
                disabled={pending}
                className="gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                {pending ? "Enviando..." : "Solicitar validación"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
