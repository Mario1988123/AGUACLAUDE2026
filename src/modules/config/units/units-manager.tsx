"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { addUnitSafeAction, deleteUnitSafeAction, type UnitRow } from "./actions";

export function UnitsManager({ units }: { units: UnitRow[] }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  function add() {
    if (!code.trim() || !label.trim()) {
      notify.warning("Indica código y nombre");
      return;
    }
    startTransition(async () => {
      const r = await addUnitSafeAction({ code, label });
      if (!r.ok) {
        notify.error("No se pudo añadir", r.error);
        return;
      }
      notify.success("Unidad añadida");
      setCode("");
      setLabel("");
      router.refresh();
    });
  }

  async function remove(id: string) {
    const ok = await ask({
      message: "¿Quitar esta unidad de tu catálogo? (Las globales no se pueden borrar)",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteUnitSafeAction(id);
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      notify.success("Eliminada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Estas unidades aparecen como sugerencias al definir atributos. Las globales vienen
        precargadas; añade las propias si necesitas alguna específica.
      </p>

      <div className="grid gap-3 sm:grid-cols-3 rounded-xl border bg-background p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Código</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="L/min"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Descripción</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Litros por minuto"
          />
        </div>
        <div className="sm:col-span-3 flex justify-end">
          <Button onClick={add} disabled={pending} className="gap-1">
            <Plus className="h-4 w-4" /> Añadir unidad
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {units.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-sm"
            title={u.label}
          >
            <span className="font-bold">{u.code}</span>
            <span className="text-xs text-muted-foreground">— {u.label}</span>
            {u.is_global ? (
              <Badge variant="outline" className="text-[10px]">
                global
              </Badge>
            ) : (
              <button
                onClick={() => remove(u.id)}
                className="ml-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
