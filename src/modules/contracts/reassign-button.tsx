"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { reassignContractAction } from "./actions";

export function ReassignContractButton({
  contractId,
  currentUserId,
  team,
}: {
  contractId: string;
  currentUserId: string | null;
  team: { user_id: string; full_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(currentUserId ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      try {
        await reassignContractAction(contractId, target || null);
        notify.success(target ? "Reasignado" : "Desasignado");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Reasignar comercial
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-primary bg-primary/5 p-3">
      <Label className="text-xs">Asignar a</Label>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={pending}
        className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
      >
        <option value="">— Sin asignar —</option>
        {team.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.full_name}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
