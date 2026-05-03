"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createProposalAction } from "./actions";
import { Trash2 } from "lucide-react";

interface Props {
  customers: { id: string; name: string }[];
  leads?: { id: string; name: string }[];
  products: { id: string; name: string; cash_price_cents: number | null }[];
  defaultCustomerId?: string;
  defaultLeadId?: string;
}

interface ItemRow {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function ProposalCreateForm({
  customers,
  leads = [],
  products,
  defaultCustomerId,
  defaultLeadId,
}: Props) {
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [validityUntil, setValidityUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [pending, startTransition] = useTransition();

  function addItem() {
    if (products.length === 0) {
      notify.warning("No hay productos disponibles");
      return;
    }
    const first = products[0]!;
    setItems((prev) => [
      ...prev,
      {
        product_id: first.id,
        quantity: 1,
        unit_price_cents: first.cash_price_cents ?? 0,
      },
    ]);
  }

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if (patch.product_id) {
          const p = products.find((p) => p.id === patch.product_id);
          if (p && p.cash_price_cents != null) next.unit_price_cents = p.cash_price_cents;
        }
        return next;
      }),
    );
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = items.reduce((s, it) => s + it.unit_price_cents * it.quantity, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId && !defaultLeadId) {
      notify.warning("Selecciona destinatario");
      return;
    }
    if (items.length === 0) {
      notify.warning("Añade al menos un producto");
      return;
    }
    startTransition(async () => {
      try {
        await createProposalAction({
          customer_id: customerId || undefined,
          lead_id: defaultLeadId,
          validity_until: validityUntil || undefined,
          notes,
          items,
        });
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) {
          const d = String((err as { digest?: unknown }).digest);
          if (d.startsWith("NEXT_REDIRECT")) throw err;
        }
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{defaultLeadId ? "Lead" : "Cliente *"}</Label>
          {defaultLeadId ? (
            <div className="flex h-11 w-full items-center rounded-md border border-input bg-muted/30 px-3 text-base">
              <span className="truncate font-semibold">
                {leads.find((l) => l.id === defaultLeadId)?.name ?? "Lead seleccionado"}
              </span>
            </div>
          ) : (
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            >
              <option value="">Selecciona un cliente</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {defaultLeadId && (
            <p className="text-xs text-muted-foreground">
              Propuesta sobre lead pre-cliente. Al aceptar se convertirá en cliente.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="validity">Validez hasta</Label>
          <Input
            id="validity"
            type="date"
            value={validityUntil}
            onChange={(e) => setValidityUntil(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Productos</Label>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            + Añadir
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Pulsa “Añadir” para incluir productos.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className="grid items-end gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-[2fr_80px_140px_44px]"
              >
                <div>
                  <Label className="text-xs">Producto</Label>
                  <select
                    value={it.product_id}
                    onChange={(e) => updateItem(idx, { product_id: e.target.value })}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Cant.</Label>
                  <Input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) =>
                      updateItem(idx, { quantity: Math.max(1, Number(e.target.value)) })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Precio unit. (cts)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={it.unit_price_cents}
                    onChange={(e) =>
                      updateItem(idx, { unit_price_cents: Math.max(0, Number(e.target.value)) })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(idx)}
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <div className="rounded-md bg-muted/40 p-4 text-right">
        <div className="text-sm text-muted-foreground">Total contado</div>
        <div className="text-2xl font-bold tabular-nums">{formatCents(total)}</div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notas</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href="/propuestas">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear propuesta"}
        </Button>
      </div>
    </form>
  );
}
