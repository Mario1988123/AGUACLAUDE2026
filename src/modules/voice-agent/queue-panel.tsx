"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { PhoneCall, PhoneOff, Loader2, Ban } from "lucide-react";
import {
  seedMaintenanceCallQueueAction,
  cancelVoiceTaskAction,
  addDoNotCallAction,
  type VoiceTaskRow,
} from "./queue-actions";

const STATUS_LABEL: Record<string, string> = {
  pending: "En cola",
  calling: "Llamando",
  done: "Resuelta",
  failed: "Sin respuesta",
  cancelled: "Anulada",
};

const OUTCOME_LABEL: Record<string, string> = {
  confirmed: "Cita confirmada",
  rescheduled: "Cambió la fecha",
  postponed: "Pospuesto",
  lead_created: "Interés comercial",
  not_interested: "No interesa",
  escalated: "Pidió una persona",
  no_answer: "No contesta",
  voicemail: "Buzón",
  busy: "Comunica",
  wrong_number: "Número erróneo",
  opted_out: "Pidió no ser llamado",
  failed: "Error",
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "calling") return "secondary";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "outline";
}

export function QueuePanel({
  tasks,
  canSeed,
}: {
  tasks: VoiceTaskRow[];
  canSeed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dncPhone, setDncPhone] = useState("");

  function onSeed() {
    startTransition(async () => {
      const r = await seedMaintenanceCallQueueAction(21);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo llenar la cola");
        return;
      }
      const skipped =
        r.skipped.no_phone + r.skipped.already_queued + r.skipped.excluded;
      toast.success(
        r.enqueued === 0
          ? "No había mantenimientos nuevos que encolar."
          : `${r.enqueued} llamada${r.enqueued === 1 ? "" : "s"} en cola.` +
              (skipped > 0
                ? ` ${r.skipped.no_phone} sin teléfono, ${r.skipped.already_queued} ya estaban, ${r.skipped.excluded} excluidos.`
                : ""),
      );
    });
  }

  function onCancel(id: string) {
    startTransition(async () => {
      const r = await cancelVoiceTaskAction(id);
      if (!r.ok) toast.error(r.error ?? "No se pudo anular");
      else toast.success("Llamada anulada");
    });
  }

  function onAddDnc() {
    if (!dncPhone.trim()) return;
    startTransition(async () => {
      const r = await addDoNotCallAction(dncPhone, "Añadido a mano");
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo añadir");
        return;
      }
      setDncPhone("");
      toast.success(
        `Excluido. ${r.cancelled ?? 0} llamada${r.cancelled === 1 ? "" : "s"} en cola anulada${r.cancelled === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {canSeed && (
          <Button onClick={onSeed} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PhoneCall className="mr-2 h-4 w-4" />
            )}
            Llenar cola con los mantenimientos pendientes
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={dncPhone}
            onChange={(e) => setDncPhone(e.target.value)}
            placeholder="+34 612 34 56 78"
            className="w-48"
            aria-label="Teléfono a excluir de las llamadas"
          />
          <Button
            variant="outline"
            onClick={onAddDnc}
            disabled={pending || !dncPhone.trim()}
          >
            <Ban className="mr-2 h-4 w-4" />
            No llamar
          </Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No hay llamadas en cola. Pulsa «Llenar cola» para traer los
          mantenimientos que están esperando confirmación.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-bold">Contacto</th>
                <th className="px-3 py-2 font-bold">Teléfono</th>
                <th className="px-3 py-2 font-bold">Estado</th>
                <th className="px-3 py-2 font-bold">Resultado</th>
                <th className="px-3 py-2 font-bold">Intentos</th>
                <th className="px-3 py-2 font-bold" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {t.contact_name ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {t.to_phone_e164}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(t.status)}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.outcome ? (OUTCOME_LABEL[t.outcome] ?? t.outcome) : "—"}
                    {t.outcome_notes ? (
                      <span className="block text-xs opacity-70">
                        {t.outcome_notes}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {t.attempts}/{t.max_attempts}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(t.status === "pending" || t.status === "calling") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancel(t.id)}
                        disabled={pending}
                        aria-label={`Anular la llamada a ${t.contact_name ?? t.to_phone_e164}`}
                      >
                        <PhoneOff className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
