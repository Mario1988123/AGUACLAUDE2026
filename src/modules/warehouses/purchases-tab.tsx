"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, FileText, Undo2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  createPurchaseAction,
  returnToSupplierSafeAction,
  type PurchaseRow,
  type PurchaseDetail,
} from "./purchase-actions";

interface ProductLite {
  id: string;
  name: string;
  default_supplier_name?: string | null;
  cost_cents?: number | null;
}

function formatCents(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function PurchasesTab({
  warehouseId,
  purchases,
  details,
  products,
}: {
  warehouseId: string;
  purchases: PurchaseRow[];
  details: Map<string, PurchaseDetail>;
  products: ProductLite[];
}) {
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (creating) {
    return (
      <NewPurchaseForm
        warehouseId={warehouseId}
        products={products}
        onDone={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {purchases.length} compra(s) registrada(s) en este almacén. Cada
          compra suma stock y queda enlazada a sus movimientos.
        </p>
        <Button onClick={() => setCreating(true)} variant="success">
          <Plus className="h-4 w-4" /> Nueva compra
        </Button>
      </div>

      {purchases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin compras registradas. Pulsa «Nueva compra» para registrar el
          primer albarán/factura de proveedor.
        </div>
      ) : (
        <div className="space-y-2">
          {purchases.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border bg-card overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-bold">{p.invoice_number}</span>
                    <span className="text-sm">{p.supplier_name}</span>
                    <Badge variant="secondary">
                      {new Date(p.invoice_date).toLocaleDateString("es-ES")}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {p.items_count} producto(s) · {p.total_units} ud · total{" "}
                    {formatCents(p.total_cents)}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {openId === p.id ? "▲" : "▼"}
                </span>
              </button>
              {openId === p.id && details.get(p.id) && (
                <PurchaseDetailView
                  warehouseId={warehouseId}
                  detail={details.get(p.id)!}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PurchaseDetailView({
  warehouseId,
  detail,
}: {
  warehouseId: string;
  detail: PurchaseDetail;
}) {
  return (
    <div className="border-t bg-muted/10 p-3">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-2 text-left">Producto</th>
            <th className="py-2 text-right">Cant.</th>
            <th className="py-2 text-right">Coste/ud</th>
            <th className="py-2 text-right">Subtotal</th>
            <th className="py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {detail.items.map((it) => (
            <PurchaseItemRow
              key={it.id}
              warehouseId={warehouseId}
              purchaseId={detail.id}
              item={it}
            />
          ))}
        </tbody>
      </table>
      {detail.notes && (
        <p className="mt-3 text-xs text-muted-foreground">
          <strong>Notas:</strong> {detail.notes}
        </p>
      )}
    </div>
  );
}

function PurchaseItemRow({
  warehouseId,
  purchaseId,
  item,
}: {
  warehouseId: string;
  purchaseId: string;
  item: PurchaseDetail["items"][number];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showReturn, setShowReturn] = useState(false);
  const [retQty, setRetQty] = useState("1");
  const [retReason, setRetReason] = useState("");

  function doReturn() {
    const q = Math.floor(Number(retQty));
    if (!Number.isFinite(q) || q <= 0) {
      notify.warning("Cantidad inválida");
      return;
    }
    startTransition(async () => {
      const r = await returnToSupplierSafeAction({
        purchase_id: purchaseId,
        warehouse_id: warehouseId,
        product_id: item.product_id,
        quantity: q,
        reason: retReason || undefined,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(`${q} ud devueltas a proveedor`);
      setShowReturn(false);
      setRetQty("1");
      setRetReason("");
      router.refresh();
    });
  }

  return (
    <>
      <tr>
        <td className="py-2">{item.product_name}</td>
        <td className="py-2 text-right tabular-nums">{item.quantity}</td>
        <td className="py-2 text-right tabular-nums">
          {formatCents(item.unit_cost_cents)}
        </td>
        <td className="py-2 text-right tabular-nums font-bold">
          {formatCents(item.quantity * item.unit_cost_cents)}
        </td>
        <td className="py-2 text-right">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowReturn(!showReturn)}
            title="Devolver a proveedor"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Devolver
          </Button>
        </td>
      </tr>
      {showReturn && (
        <tr>
          <td colSpan={5} className="bg-amber-50 p-3">
            <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
              <div className="space-y-1">
                <Label className="text-xs">Cantidad a devolver</Label>
                <Input
                  type="number"
                  min={1}
                  max={item.quantity}
                  value={retQty}
                  onChange={(e) => setRetQty(e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Motivo</Label>
                <Input
                  value={retReason}
                  onChange={(e) => setRetReason(e.target.value)}
                  placeholder="Defectuoso, mal modelo, sobrante…"
                />
              </div>
              <div className="sm:col-span-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowReturn(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="warning"
                  onClick={doReturn}
                  disabled={pending}
                >
                  {pending ? "Procesando…" : "Confirmar devolución"}
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface DraftLine {
  product_id: string;
  quantity: string;
  unit_cost: string; // €
  /** Código de lote del proveedor (opcional). Si se deja vacío, se usa
   *  el nº de albarán como lot_code en stock_lots. */
  lot_code: string;
}

function NewPurchaseForm({
  warehouseId,
  products,
  onDone,
}: {
  warehouseId: string;
  products: ProductLite[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [supplier, setSupplier] = useState("");
  const [taxId, setTaxId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { product_id: "", quantity: "1", unit_cost: "", lot_code: "" },
  ]);

  function setLine(idx: number, patch: Partial<DraftLine>) {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((arr) => [
      ...arr,
      { product_id: "", quantity: "1", unit_cost: "", lot_code: "" },
    ]);
  }
  function removeLine(idx: number) {
    setLines((arr) => arr.filter((_, i) => i !== idx));
  }

  // Cuando eligen producto, precargar coste con cost_cents actual y supplier
  function onPickProduct(idx: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLine(idx, {
      product_id: productId,
      unit_cost: p?.cost_cents != null ? (p.cost_cents / 100).toFixed(2) : "",
    });
    if (!supplier && p?.default_supplier_name) setSupplier(p.default_supplier_name);
  }

  const total = lines.reduce((s, l) => {
    const q = Number(l.quantity);
    const c = Number((l.unit_cost ?? "").replace(",", "."));
    if (!Number.isFinite(q) || !Number.isFinite(c)) return s;
    return s + q * c;
  }, 0);

  function save() {
    if (!supplier.trim() || !invoiceNumber.trim()) {
      notify.warning("Faltan proveedor o nº albarán");
      return;
    }
    const items = lines
      .filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({
        product_id: l.product_id,
        quantity: Math.floor(Number(l.quantity)),
        unit_cost_cents: Math.round(
          Number((l.unit_cost ?? "0").replace(",", ".")) * 100,
        ),
        lot_code: l.lot_code.trim() || null,
      }));
    if (items.length === 0) {
      notify.warning("Añade al menos una línea válida");
      return;
    }
    startTransition(async () => {
      const r = await createPurchaseAction({
        warehouse_id: warehouseId,
        supplier_name: supplier,
        supplier_tax_id: taxId || undefined,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        notes: notes || undefined,
        items,
      });
      if (r.ok) {
        notify.success("Compra registrada", `${items.length} línea(s) añadidas al stock`);
        onDone();
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border-2 border-success/40 bg-success/5 p-4">
      <h3 className="text-sm font-bold">Nueva compra (albarán/factura)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Proveedor *</Label>
          <Input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Senda Aguas, etc."
          />
        </div>
        <div className="space-y-1">
          <Label>CIF/NIF (opcional)</Label>
          <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Nº albarán/factura *</Label>
          <Input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="ALB-2026-001"
          />
        </div>
        <div className="space-y-1">
          <Label>Fecha *</Label>
          <Input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Notas</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-bold">Líneas</Label>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" /> Línea
          </Button>
        </div>
        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div
              key={idx}
              className="grid gap-2 sm:grid-cols-[1fr_80px_100px_120px_auto] items-end rounded-lg border bg-card p-2"
            >
              <div className="space-y-1">
                <Label className="text-xs">Producto</Label>
                <select
                  value={l.product_id}
                  onChange={(e) => onPickProduct(idx, e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
                <Label className="text-xs">Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setLine(idx, { quantity: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Coste/ud (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={l.unit_cost}
                  onChange={(e) => setLine(idx, { unit_cost: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" title="Si se deja vacío se usa el nº de albarán como lot_code.">
                  Nº lote
                </Label>
                <Input
                  value={l.lot_code}
                  onChange={(e) => setLine(idx, { lot_code: e.target.value })}
                  placeholder="Opcional"
                  className="h-9 font-mono text-xs"
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeLine(idx)}
                disabled={lines.length === 1}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
        <span className="text-sm font-bold">Total compra</span>
        <span className="text-lg font-extrabold tabular-nums">
          {new Intl.NumberFormat("es-ES", {
            style: "currency",
            currency: "EUR",
          }).format(total)}
        </span>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="success" onClick={save} disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Guardando…" : "Guardar compra"}
        </Button>
      </div>
    </div>
  );
}
