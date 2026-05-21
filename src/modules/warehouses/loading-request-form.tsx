"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { createLoadingRequestSafeAction } from "./loading-request-actions";

interface ProductOpt {
  id: string;
  name: string;
}
interface WarehouseOpt {
  id: string;
  name: string;
  kind: string;
}

interface ItemRow {
  product_id: string;
  quantity_requested: number;
}

export function CreateLoadingRequestButton({
  warehouses,
  products,
}: {
  warehouses: WarehouseOpt[];
  products: ProductOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const sources = warehouses.filter((w) => w.kind === "main" || w.kind === "secondary");
  const dests = warehouses.filter((w) => w.kind === "vehicle");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [destId, setDestId] = useState(dests[0]?.id ?? "");
  const [neededFor, setNeededFor] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);

  function addItem() {
    if (products.length === 0) return;
    setItems((p) => [...p, { product_id: products[0]!.id, quantity_requested: 1 }]);
  }
  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((p) => p.filter((_, i) => i !== idx));
  }

  function submit() {
    if (!sourceId || !destId) {
      notify.warning("Selecciona origen y destino");
      return;
    }
    if (items.length === 0) {
      notify.warning("Añade al menos un producto");
      return;
    }
    startTransition(async () => {
      const r = await createLoadingRequestSafeAction({
        source_warehouse_id: sourceId,
        destination_warehouse_id: destId,
        needed_for: neededFor || undefined,
        notes: notes || undefined,
        items,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Solicitud creada");
      setOpen(false);
      setItems([]);
      setNotes("");
      location.reload();
    });
  }

  if (sources.length === 0 || dests.length === 0) {
    return (
      <Button variant="outline" disabled title="Necesitas un almacén origen y al menos una furgoneta">
        <Truck className="h-4 w-4" /> Solicitar carga
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Truck className="h-4 w-4" /> Solicitar carga
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Solicitud de carga</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Origen</Label>
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {sources.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Destino (vehículo)</Label>
              <select
                value={destId}
                onChange={(e) => setDestId(e.target.value)}
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {dests.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Necesario para (fecha)</Label>
              <Input
                type="date"
                value={neededFor}
                onChange={(e) => setNeededFor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold uppercase tracking-wide">Productos</Label>
              <Button variant="outline" size="sm" onClick={addItem} type="button">
                <Plus className="h-4 w-4" /> Añadir
              </Button>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Añade los productos a cargar.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it, idx) => (
                  <li key={idx} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
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
                    <div className="w-24">
                      <Input
                        type="number"
                        min={1}
                        value={it.quantity_requested}
                        onChange={(e) =>
                          updateItem(idx, { quantity_requested: Number(e.target.value) })
                        }
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

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setOpen(false)} type="button">
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Creando..." : "Crear solicitud"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
