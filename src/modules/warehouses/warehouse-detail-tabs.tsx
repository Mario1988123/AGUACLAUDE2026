"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowRightLeft,
  ClipboardList,
  History,
  Boxes,
  Save,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  addStockAction,
  setStockQuantityAction,
  type StockMovementRow,
} from "./inventory-actions";
import { transferStockAction } from "./transfer-actions";
import type { WarehouseStockDetail } from "./stock-summary-actions";

interface ProductLite {
  id: string;
  name: string;
}
interface WarehouseLite {
  id: string;
  name: string;
}

const TAB_LABEL: Record<string, string> = {
  stock: "Stock",
  transfer: "Traspasos",
  inventory: "Inventario",
  history: "Histórico",
};

const MOVEMENT_LABEL: Record<string, string> = {
  inbound: "Entrada proveedor",
  outbound_install: "Salida instalación",
  outbound_trial: "Salida prueba",
  outbound_maintenance: "Salida mantenimiento",
  transfer_out: "Traspaso salida",
  transfer_in: "Traspaso entrada",
  return: "Devolución",
  adjustment_plus: "Ajuste +",
  adjustment_minus: "Ajuste −",
};

const MOVEMENT_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  inbound: "success",
  outbound_install: "warning",
  outbound_trial: "warning",
  outbound_maintenance: "warning",
  transfer_out: "secondary",
  transfer_in: "default",
  return: "default",
  adjustment_plus: "success",
  adjustment_minus: "destructive",
};

export function WarehouseDetailTabs({
  warehouseId,
  stock,
  movements,
  products,
  otherWarehouses,
}: {
  warehouseId: string;
  stock: WarehouseStockDetail[];
  movements: StockMovementRow[];
  products: ProductLite[];
  otherWarehouses: WarehouseLite[];
}) {
  const [tab, setTab] = useState<"stock" | "transfer" | "inventory" | "history">("stock");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b">
        {(["stock", "transfer", "inventory", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "stock" && <Boxes className="h-4 w-4" />}
            {t === "transfer" && <ArrowRightLeft className="h-4 w-4" />}
            {t === "inventory" && <ClipboardList className="h-4 w-4" />}
            {t === "history" && <History className="h-4 w-4" />}
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <StockTab warehouseId={warehouseId} stock={stock} products={products} />
      )}
      {tab === "transfer" && (
        <TransferTab
          warehouseId={warehouseId}
          stock={stock}
          otherWarehouses={otherWarehouses}
        />
      )}
      {tab === "inventory" && (
        <InventoryTab warehouseId={warehouseId} stock={stock} products={products} />
      )}
      {tab === "history" && <HistoryTab movements={movements} />}
    </div>
  );
}

function StockTab({
  warehouseId,
  stock,
  products,
}: {
  warehouseId: string;
  stock: WarehouseStockDetail[];
  products: ProductLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");

  function add() {
    if (!productId) {
      notify.warning("Selecciona producto");
      return;
    }
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) {
      notify.warning("Cantidad inválida");
      return;
    }
    startTransition(async () => {
      try {
        await addStockAction({
          warehouse_id: warehouseId,
          product_id: productId,
          quantity: q,
          notes: notes || undefined,
        });
        notify.success(`+${q} añadidas`);
        setShowAdd(false);
        setProductId("");
        setQty("1");
        setNotes("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stock.length} producto(s) con stock
        </p>
        <Button onClick={() => setShowAdd((v) => !v)} variant="success" size="sm">
          <Plus className="h-4 w-4" /> Añadir stock
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border-2 border-success/40 bg-success/5 p-4 space-y-3">
          <h3 className="text-sm font-bold">Añadir entrada de stock</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Producto</Label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Elegir —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Cantidad</Label>
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label>Notas (opcional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Albarán proveedor, factura, etc."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={add} disabled={pending} variant="success">
              {pending ? "Añadiendo…" : "Añadir"}
            </Button>
          </div>
        </div>
      )}

      {stock.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin stock todavía. Pulsa «Añadir stock» para registrar la primera entrada.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Producto</th>
                <th className="px-4 py-2 text-right">Cantidad</th>
                <th className="px-4 py-2 text-right">Mín.</th>
                <th className="px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stock.map((s) => (
                <tr key={s.product_id} className={s.is_low ? "bg-destructive/5" : ""}>
                  <td className="px-4 py-2 font-medium">{s.product_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold">{s.total}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {s.stock_min ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {s.is_low ? (
                      <Badge variant="destructive">⚠ Bajo</Badge>
                    ) : (
                      <Badge variant="success">OK</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TransferTab({
  warehouseId,
  stock,
  otherWarehouses,
}: {
  warehouseId: string;
  stock: WarehouseStockDetail[];
  otherWarehouses: WarehouseLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [productId, setProductId] = useState("");
  const [destId, setDestId] = useState(otherWarehouses[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");

  const productStock = stock.find((s) => s.product_id === productId);
  const maxQty = productStock?.total ?? 0;

  function transfer() {
    if (!productId || !destId) {
      notify.warning("Falta producto o destino");
      return;
    }
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) {
      notify.warning("Cantidad inválida");
      return;
    }
    if (q > maxQty) {
      notify.warning(`Solo hay ${maxQty} unidades`);
      return;
    }
    startTransition(async () => {
      try {
        await transferStockAction({
          from_warehouse_id: warehouseId,
          to_warehouse_id: destId,
          product_id: productId,
          quantity: q,
          notes: notes || undefined,
        });
        notify.success("Traspaso registrado");
        setProductId("");
        setQty("1");
        setNotes("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (otherWarehouses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No hay otros almacenes a los que traspasar. Crea otro almacén primero.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Mueve stock de este almacén a otro. Se generan dos movimientos
        (salida + entrada) y se notifica al admin.
      </p>
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Producto</Label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">— Elegir —</option>
              {stock.map((s) => (
                <option key={s.product_id} value={s.product_id}>
                  {s.product_name} (stock: {s.total})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Almacén destino</Label>
            <select
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              {otherWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Cantidad {productId && `(máx ${maxQty})`}</Label>
            <Input
              type="number"
              min={1}
              max={maxQty || undefined}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Notas</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo, albarán…"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={transfer} disabled={pending} variant="success">
            <ArrowRightLeft className="h-4 w-4" />
            {pending ? "Traspasando…" : "Hacer traspaso"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InventoryTab({
  warehouseId,
  stock,
  products,
}: {
  warehouseId: string;
  stock: WarehouseStockDetail[];
  products: ProductLite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Mapa actual + para cualquier producto del catálogo.
  const stockMap = new Map(stock.map((s) => [s.product_id, s.total]));
  // Iniciamos los inputs con la cantidad actual.
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of products) {
      init[p.id] = String(stockMap.get(p.id) ?? 0);
    }
    return init;
  });

  function saveAll() {
    const changes: Array<{ product_id: string; new_quantity: number }> = [];
    for (const p of products) {
      const newQ = Math.max(0, Math.floor(Number(counts[p.id] ?? "0")));
      const oldQ = stockMap.get(p.id) ?? 0;
      if (Number.isFinite(newQ) && newQ !== oldQ) {
        changes.push({ product_id: p.id, new_quantity: newQ });
      }
    }
    if (changes.length === 0) {
      notify.info("Sin cambios", "Todas las cantidades coinciden con el stock actual");
      return;
    }
    startTransition(async () => {
      try {
        for (const c of changes) {
          await setStockQuantityAction({
            warehouse_id: warehouseId,
            product_id: c.product_id,
            new_quantity: c.new_quantity,
          });
        }
        notify.success(`${changes.length} ajuste(s) guardados`);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold">Recuento de inventario</h3>
          <p className="text-xs text-muted-foreground">
            Apunta las unidades reales que hay en este almacén. Solo se
            generan movimientos de ajuste para los productos cuya cantidad
            cambie.
          </p>
        </div>
        <Button onClick={saveAll} disabled={pending} variant="success">
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar inventario"}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Producto</th>
              <th className="px-4 py-2 text-right">Stock actual</th>
              <th className="px-4 py-2 text-right">Recuento real</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map((p) => {
              const current = stockMap.get(p.id) ?? 0;
              const counted = Math.floor(Number(counts[p.id] ?? "0"));
              const diff = Number.isFinite(counted) ? counted - current : 0;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{current}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <Input
                        type="number"
                        min={0}
                        value={counts[p.id] ?? "0"}
                        onChange={(e) =>
                          setCounts((m) => ({ ...m, [p.id]: e.target.value }))
                        }
                        className="h-9 w-24 text-right tabular-nums"
                      />
                      {diff !== 0 && Number.isFinite(diff) && (
                        <span
                          className={`text-xs font-bold ${
                            diff > 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTab({ movements }: { movements: StockMovementRow[] }) {
  if (movements.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Sin movimientos registrados.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left">Fecha</th>
            <th className="px-4 py-2 text-left">Tipo</th>
            <th className="px-4 py-2 text-left">Producto</th>
            <th className="px-4 py-2 text-right">Cant.</th>
            <th className="px-4 py-2 text-left">Detalle</th>
            <th className="px-4 py-2 text-left">Usuario</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {movements.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                {new Date(m.performed_at).toLocaleString("es-ES")}
              </td>
              <td className="px-4 py-2">
                <Badge variant={MOVEMENT_VARIANT[m.movement_type] ?? "default"}>
                  {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                </Badge>
              </td>
              <td className="px-4 py-2">{m.product_name}</td>
              <td className="px-4 py-2 text-right tabular-nums font-bold">
                {m.quantity}
              </td>
              <td className="px-4 py-2 text-xs text-muted-foreground">
                {m.destination_warehouse_name && (
                  <>→ {m.destination_warehouse_name} · </>
                )}
                {m.notes}
              </td>
              <td className="px-4 py-2 text-xs">{m.performed_by_name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
