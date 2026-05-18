"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Package } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  createStockLotAction,
  deleteStockLotAction,
  type StockLotRow,
} from "./lot-actions";

interface Props {
  warehouseId: string;
  lots: StockLotRow[];
  products: Array<{ id: string; name: string }>;
  canManage: boolean;
}

function fmtEur(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export function LotsTab({ warehouseId, lots, products, canManage }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [receivedAt, setReceivedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [unitCostEur, setUnitCostEur] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setProductId("");
    setQty("");
    setLotCode("");
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setUnitCostEur("");
    setNotes("");
    setOpen(false);
  }

  function save() {
    if (!productId) {
      notify.warning("Selecciona producto");
      return;
    }
    if (!qty || Number(qty) <= 0) {
      notify.warning("Cantidad obligatoria");
      return;
    }
    startTransition(async () => {
      const r = await createStockLotAction({
        warehouse_id: warehouseId,
        product_id: productId,
        initial_quantity: Number(qty),
        lot_code: lotCode.trim() || null,
        received_at: new Date(receivedAt + "T12:00:00").toISOString(),
        unit_cost_cents: unitCostEur
          ? Math.round(Number(unitCostEur) * 100)
          : null,
        notes: notes.trim() || null,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Lote registrado");
      reset();
      router.refresh();
    });
  }

  async function remove(lot: StockLotRow) {
    const ok = await ask({
      title: "Eliminar lote",
      message:
        "Solo se pueden eliminar lotes sin consumir. Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteStockLotAction(lot.id);
      if (!r.ok) {
        notify.error("No se pudo eliminar", r.error);
        return;
      }
      notify.success("Lote eliminado");
      router.refresh();
    });
  }

  const active = lots.filter((l) => Number(l.remaining_quantity) > 0);
  const depleted = lots.filter((l) => Number(l.remaining_quantity) <= 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-xs text-blue-900">
        <strong className="font-bold">FIFO automático.</strong> Cuando se hace
        una salida (instalación, traspaso, ajuste) el sistema consume el lote
        más antiguo primero. No hay caducidad — los equipos de agua no caducan
        pero conviene rotar el stock más viejo. Si has registrado una compra
        en la pestaña «Compras», el lote se crea automáticamente.
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo lote manual
          </Button>
        </div>
      )}

      {open && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Registrar entrada de lote</h3>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancelar
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Úsalo solo si <strong>NO</strong> has registrado la compra en la
            pestaña «Compras» — esa ya crea el lote automáticamente.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Producto *</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Selecciona —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cantidad *</Label>
              <Input
                type="number"
                step="1"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código de lote</Label>
              <Input
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value)}
                placeholder="Opcional — del fabricante o interno"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha de recepción</Label>
              <Input
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Coste unitario (€)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={unitCostEur}
                onChange={(e) => setUnitCostEur(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Notas</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones del lote"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={save} disabled={pending} variant="success">
              {pending ? "Creando…" : "Crear lote"}
            </Button>
          </div>
        </div>
      )}

      {active.length === 0 && depleted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-2 h-6 w-6 opacity-50" />
          Sin lotes registrados todavía. Cuando registres una compra de
          proveedor, el lote se creará automáticamente con fecha y coste.
        </div>
      ) : (
        <div className="space-y-3">
          {active.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                Activos ({active.length}) · Se consumen FIFO de arriba abajo
              </h3>
              <ul className="space-y-1.5">
                {active.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{l.product_name}</span>
                        {l.lot_code && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {l.lot_code}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Recibido{" "}
                        {new Date(l.received_at).toLocaleDateString("es-ES")}
                        {l.notes && ` · ${l.notes}`}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-bold tabular-nums">
                        {Number(l.remaining_quantity)} / {Number(l.initial_quantity)} ud
                      </div>
                      {l.unit_cost_cents != null && (
                        <div className="text-muted-foreground">
                          {fmtEur(l.unit_cost_cents)} /ud
                        </div>
                      )}
                    </div>
                    {canManage &&
                      Number(l.remaining_quantity) === Number(l.initial_quantity) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(l)}
                          disabled={pending}
                          title="Eliminar (solo si no se ha consumido nada)"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {depleted.length > 0 && (
            <details className="rounded-xl border border-border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Agotados ({depleted.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {depleted.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 rounded-lg bg-card p-2 text-xs text-muted-foreground"
                  >
                    <span className="flex-1 truncate">
                      {l.product_name}
                      {l.lot_code && ` · ${l.lot_code}`}
                    </span>
                    <span>
                      {new Date(l.received_at).toLocaleDateString("es-ES")} ·{" "}
                      {Number(l.initial_quantity)} ud
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
