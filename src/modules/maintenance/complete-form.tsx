"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { completeMaintenanceAction } from "./actions";

interface ProductOpt {
  id: string;
  name: string;
}

interface ReplaceItem {
  product_id: string;
  quantity: number;
}

export function MaintenanceCompleteForm({
  maintenanceId,
  products,
}: {
  maintenanceId: string;
  products: ProductOpt[];
}) {
  const [items, setItems] = useState<ReplaceItem[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function addItem() {
    if (products.length === 0) return;
    setItems((prev) => [...prev, { product_id: products[0]!.id, quantity: 1 }]);
  }

  function updateItem(idx: number, patch: Partial<ReplaceItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    startTransition(async () => {
      try {
        await completeMaintenanceAction({
          id: maintenanceId,
          notes: notes || undefined,
          replaced_items: items,
        });
        notify.success("Mantenimiento completado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold uppercase tracking-wide">Recambios</Label>
          <Button variant="outline" size="sm" onClick={addItem} type="button">
            <Plus className="h-4 w-4" /> Añadir
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Añade los productos consumidos. Se descontarán del stock automáticamente.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Producto</Label>
                  <select
                    value={it.product_id}
                    onChange={(e) => updateItem(idx, { product_id: e.target.value })}
                    className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 space-y-1.5">
                  <Label className="text-xs">Cant.</Label>
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="h-12 w-12 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Notas del técnico</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          placeholder="Observaciones, estado del equipo, etc."
        />
      </div>

      <Button onClick={submit} disabled={pending} size="lg" className="w-full">
        <CheckCircle2 className="h-5 w-5" />
        {pending ? "Guardando..." : "Completar mantenimiento"}
      </Button>
    </div>
  );
}
