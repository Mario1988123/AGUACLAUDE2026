"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { bulkReassignLeadsAction } from "./bulk-actions";

export function ReassignLeadButton({
  leadId,
  currentUserId,
  team,
}: {
  leadId: string;
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
        await bulkReassignLeadsAction({
          lead_ids: [leadId],
          user_id: target || null,
        });
        notify.success(target ? "Reasignado" : "Desasignado");
        setOpen(false);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Reasignar
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reasignar lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
