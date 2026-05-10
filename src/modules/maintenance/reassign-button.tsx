"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { reassignMaintenanceAction } from "./actions";

export function ReassignMaintenanceButton({
  maintenanceId,
  currentUserId,
  technicians,
}: {
  maintenanceId: string;
  currentUserId: string | null;
  technicians: { user_id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentUserId ?? "");

  function save() {
    startTransition(async () => {
      const r = await reassignMaintenanceAction(maintenanceId, selected || null);
      if (r.ok) {
        notify.success("Mantenimiento reasignado");
        setOpen(false);
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        <UserCog className="h-4 w-4" /> Reasignar
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 p-4">
              <h2 className="text-lg font-bold">Reasignar mantenimiento</h2>
              <div className="space-y-1">
                <Label>Nuevo técnico</Label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Sin asignar —</option>
                  {technicians.map((t) => (
                    <option key={t.user_id} value={t.user_id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending} variant="success">
                {pending ? "Guardando…" : "Reasignar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
