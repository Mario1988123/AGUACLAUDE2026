"use client";

import { useState, useTransition } from "react";
import { Undo2, UserPlus, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  assignRecoverySafeAction,
  markRecoveredSafeAction,
  reopenLostSaleSafeAction,
  purgeLostSaleCustomerAction,
} from "./actions";

export function LostSaleRowActions({
  lostSaleId,
  hasLead,
  isRecovered,
  assignedUserId,
  team,
  origin,
  customerId,
  canPurge,
}: {
  lostSaleId: string;
  hasLead: boolean;
  isRecovered: boolean;
  assignedUserId: string | null;
  team: { user_id: string; full_name: string }[];
  origin?: string;
  customerId?: string | null;
  canPurge?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [assignTo, setAssignTo] = useState(assignedUserId ?? "");
  const ask = useConfirm();

  // Borrado definitivo (solo clientes dados de baja, solo admin).
  const showPurge =
    !!canPurge && origin === "customer_churned" && !!customerId;
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeWord, setPurgeWord] = useState("");
  const purgeWordOk = purgeWord.trim().toLowerCase() === "borrar";

  function purge() {
    if (!purgeWordOk) {
      notify.warning("Escribe «borrar» para confirmar");
      return;
    }
    startTransition(async () => {
      const r = await purgeLostSaleCustomerAction({
        lost_sale_id: lostSaleId,
        confirm_word: purgeWord,
      });
      if (!r.ok) {
        notify.error("No se pudo borrar", r.error);
        return;
      }
      notify.success("Cliente borrado definitivamente");
      setPurgeOpen(false);
      location.reload();
    });
  }

  if (isRecovered) {
    return <span className="text-xs text-success">✓ Recuperada</span>;
  }

  function assign() {
    startTransition(async () => {
      const r = await assignRecoverySafeAction(lostSaleId, assignTo);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(assignTo ? "Asignada para recuperación" : "Desasignada");
    });
  }

  async function reopen() {
    const ok = await ask({
      message: "¿Reabrir el lead asociado y mover esta venta a recuperada?",
      confirmText: "Reabrir",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await reopenLostSaleSafeAction(lostSaleId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Lead reabierto");
      location.reload();
    });
  }

  function done() {
    startTransition(async () => {
      const r = await markRecoveredSafeAction(lostSaleId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Marcada recuperada");
      location.reload();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <select
        value={assignTo}
        onChange={(e) => setAssignTo(e.target.value)}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">— Sin asignar —</option>
        {team.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.full_name}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={assign} disabled={pending}>
        <UserPlus className="h-3 w-3" />
      </Button>
      {hasLead && (
        <Button size="sm" variant="outline" onClick={reopen} disabled={pending}>
          <Undo2 className="h-3 w-3" /> Reabrir
        </Button>
      )}
      <Button size="sm" variant="success" onClick={done} disabled={pending}>
        <CheckCircle2 className="h-3 w-3" /> Recuperada
      </Button>
      {showPurge && (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            setPurgeWord("");
            setPurgeOpen(true);
          }}
          disabled={pending}
          title="Borrar definitivamente (anonimiza al cliente)"
        >
          <Trash2 className="h-3 w-3" /> Borrar
        </Button>
      )}

      {purgeOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setPurgeOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">Borrar definitivamente</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Se borrarán los datos personales del cliente (nombre, teléfono,
              DNI, direcciones…) y desaparecerá de Clientes. Esta fila de venta
              perdida se conserva para la estadística. <strong>No se puede
              deshacer.</strong>
            </p>
            <p className="mt-3 text-xs font-medium text-destructive">
              Escribe <strong>borrar</strong> para confirmar:
            </p>
            <Input
              value={purgeWord}
              onChange={(e) => setPurgeWord(e.target.value)}
              placeholder="borrar"
              autoComplete="off"
              className="mt-1"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setPurgeOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={purge}
                disabled={pending || !purgeWordOk}
              >
                {pending ? "Borrando…" : "Borrar definitivamente"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
