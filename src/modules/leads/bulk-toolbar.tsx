"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  bulkReassignLeadsAction,
  bulkUpdateLeadsStatusAction,
} from "./bulk-actions";
import { LEAD_STATUS, STATUS_LABEL } from "./schemas";

interface Props {
  selectedIds: string[];
  team: { user_id: string; full_name: string }[];
  onClear: () => void;
}

export function LeadBulkToolbar({ selectedIds, team, onClear }: Props) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState("");
  const [newStatus, setNewStatus] = useState<string>("");
  const router = useRouter();
  const ask = useConfirm();

  if (selectedIds.length === 0) return null;

  function reassign() {
    startTransition(async () => {
      const r = await bulkReassignLeadsAction({
        lead_ids: selectedIds,
        user_id: target || null,
      });
      if (!r.ok) {
        notify.error("No se pudo reasignar", r.error);
        return;
      }
      notify.success(`Reasignados ${r.count} leads`);
      onClear();
      router.refresh();
    });
  }

  async function changeStatus() {
    if (!newStatus) {
      notify.warning("Selecciona un nuevo estado");
      return;
    }
    const ok = await ask({
      title: "Cambiar estado en lote",
      message: `¿Cambiar ${selectedIds.length} leads a estado «${
        STATUS_LABEL[newStatus as keyof typeof STATUS_LABEL] ?? newStatus
      }»?`,
      confirmText: "Cambiar",
      variant: "warning",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await bulkUpdateLeadsStatusAction({
        lead_ids: selectedIds,
        status: newStatus as never,
      });
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        return;
      }
      notify.success(`${r.count} leads actualizados`);
      onClear();
      router.refresh();
    });
  }

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-primary bg-primary/10 p-3 shadow-md">
      <Users className="h-4 w-4 text-primary" />
      <span className="text-sm font-bold text-primary">
        {selectedIds.length} seleccionados
      </span>
      <div className="flex items-center gap-1.5">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={pending}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">— Desasignar —</option>
          {team.map((t) => (
            <option key={t.user_id} value={t.user_id}>
              {t.full_name}
            </option>
          ))}
        </select>
        <Button onClick={reassign} disabled={pending} size="sm">
          <RefreshCw className="h-3 w-3" /> Reasignar
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value)}
          disabled={pending}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">— Cambiar estado —</option>
          {LEAD_STATUS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Button
          onClick={changeStatus}
          disabled={pending || !newStatus}
          size="sm"
          variant="outline"
        >
          Aplicar
        </Button>
      </div>
      <Button onClick={onClear} variant="ghost" size="sm" className="ml-auto">
        <Trash2 className="h-3 w-3" /> Cancelar
      </Button>
    </div>
  );
}
