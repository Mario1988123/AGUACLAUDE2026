"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { startStockCountAction } from "./stock-count-actions";

export function StartCountButton({
  warehouses,
}: {
  warehouses: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [wid, setWid] = useState("");
  const [label, setLabel] = useState("");

  function submit() {
    if (!wid) {
      notify.warning("Selecciona almacén");
      return;
    }
    if (label.trim().length < 3) {
      notify.warning("Etiqueta corta");
      return;
    }
    startTransition(async () => {
      const r = await startStockCountAction({
        warehouse_id: wid,
        label: label.trim(),
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Conteo iniciado");
      setOpen(false);
      setLabel("");
      setWid("");
      router.push(`/almacenes/conteo/${r.id}` as never);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" /> Nuevo conteo
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-3 p-4">
              <h3 className="font-bold">Nuevo conteo cíclico</h3>
              <div className="space-y-1.5">
                <Label>Almacén</Label>
                <select
                  value={wid}
                  onChange={(e) => setWid(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">— Selecciona —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Etiqueta</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ej. Conteo octubre 2026"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={pending}
                variant="success"
              >
                {pending ? "Creando..." : "Empezar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
