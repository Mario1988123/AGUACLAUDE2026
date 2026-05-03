"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { bulkReassignCustomersAction } from "./bulk-actions";

export function CustomerBulkToolbar({
  selectedIds,
  team,
  onClear,
}: {
  selectedIds: string[];
  team: { user_id: string; full_name: string }[];
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState("");
  const router = useRouter();

  if (selectedIds.length === 0) return null;

  function reassign() {
    startTransition(async () => {
      try {
        const n = await bulkReassignCustomersAction({
          customer_ids: selectedIds,
          user_id: target || null,
        });
        notify.success(`Reasignados ${n} clientes`);
        onClear();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-primary bg-primary/10 p-3 shadow-md">
      <Users className="h-4 w-4 text-primary" />
      <span className="text-sm font-bold text-primary">{selectedIds.length} seleccionados</span>
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
        Reasignar
      </Button>
      <Button onClick={onClear} variant="ghost" size="sm">
        Cancelar
      </Button>
    </div>
  );
}
