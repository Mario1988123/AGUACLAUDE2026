"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createInvoiceAction, type InvoiceLine } from "./actions";

interface CustomerOpt {
  id: string;
  name: string;
}

function eur(c: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function NewInvoiceForm({
  customers,
  defaultIva,
}: {
  customers: CustomerOpt[];
  defaultIva: number;
}) {
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([
    {
      description: "",
      quantity: 1,
      unit_price_cents: 0,
      discount_percent: 0,
      tax_rate_percent: defaultIva,
    },
  ]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function setLine(idx: number, patch: Partial<InvoiceLine>) {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((cur) => [
      ...cur,
      {
        description: "",
        quantity: 1,
        unit_price_cents: 0,
        discount_percent: 0,
        tax_rate_percent: defaultIva,
      },
    ]);
  }
  function removeLine(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx));
  }

  const totals = lines.reduce(
    (acc, l) => {
      const gross = l.unit_price_cents * l.quantity;
      const discount = Math.round((gross * l.discount_percent) / 100);
      const subtotal = gross - discount;
      const tax = Math.round((subtotal * l.tax_rate_percent) / 100);
      acc.subtotal += subtotal;
      acc.tax += tax;
      return acc;
    },
    { subtotal: 0, tax: 0 },
  );

  function save() {
    if (!customerId) {
      notify.warning("Elige un cliente");
      return;
    }
    if (lines.some((l) => !l.description || l.unit_price_cents < 0)) {
      notify.warning("Cada línea necesita descripción y precio");
      return;
    }
    startTransition(async () => {
      try {
        const id = await createInvoiceAction({
          customer_id: customerId,
          lines,
          notes: notes || null,
        });
        notify.success("Factura creada en borrador");
        router.push(`/facturas/${id}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
          >
            <option value="">— Elige cliente —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Líneas</span>
            <Button size="sm" variant="outline" onClick={addLine} className="gap-1">
              <Plus className="h-4 w-4" /> Añadir línea
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 items-end gap-2 rounded-xl border bg-background p-3"
            >
              <div className="col-span-12 sm:col-span-4 space-y-1">
                <Label className="text-xs">Descripción</Label>
                <Input
                  value={l.description}
                  onChange={(e) => setLine(idx, { description: e.target.value })}
                  placeholder="Producto / servicio"
                />
              </div>
              <div className="col-span-3 sm:col-span-1 space-y-1">
                <Label className="text-xs">Cant.</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={l.quantity}
                  onChange={(e) => setLine(idx, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-4 sm:col-span-2 space-y-1">
                <Label className="text-xs">Precio unidad (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={(l.unit_price_cents / 100).toFixed(2)}
                  onChange={(e) =>
                    setLine(idx, { unit_price_cents: Math.round(Number(e.target.value) * 100) })
                  }
                />
              </div>
              <div className="col-span-2 sm:col-span-1 space-y-1">
                <Label className="text-xs">Dto%</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={l.discount_percent}
                  onChange={(e) => setLine(idx, { discount_percent: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2 sm:col-span-2 space-y-1">
                <Label className="text-xs">IVA%</Label>
                <select
                  value={l.tax_rate_percent}
                  onChange={(e) => setLine(idx, { tax_rate_percent: Number(e.target.value) })}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value={0}>0%</option>
                  <option value={4}>4%</option>
                  <option value={10}>10%</option>
                  <option value={21}>21%</option>
                </select>
              </div>
              <div className="col-span-1 sm:col-span-1 space-y-1">
                <Label className="text-xs">&nbsp;</Label>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="col-span-12 sm:col-span-1 text-right">
                <Label className="text-xs">Subtotal</Label>
                <div className="text-sm font-bold tabular-nums">
                  {eur(
                    l.unit_price_cents * l.quantity * (1 - l.discount_percent / 100),
                  )}
                </div>
              </div>
            </div>
          ))}

          <div className="ml-auto w-full sm:w-72 rounded-xl border bg-card p-4 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{eur(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>IVA</span>
              <span className="tabular-nums">{eur(totals.tax)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-bold text-base">
              <span>Total</span>
              <span className="tabular-nums">{eur(totals.subtotal + totals.tax)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notas (opcional)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-card p-3 text-sm"
            placeholder="Concepto, observaciones..."
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={pending} variant="success">
          {pending ? "Creando..." : "Crear factura"}
        </Button>
      </div>
    </div>
  );
}
