"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import {
  recordCountedQtyAction,
  completeStockCountAction,
} from "./stock-count-actions";

interface Item {
  id: string;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  expected_qty: number;
  counted_qty: number | null;
  diff: number | null;
}

export function CountItemsForm({
  countId,
  initialStatus,
  items,
}: {
  countId: string;
  initialStatus: "open" | "completed" | "cancelled";
  items: Item[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("");
  const [local, setLocal] = useState<Record<string, string>>(
    Object.fromEntries(
      items.map((i) => [
        i.id,
        i.counted_qty != null ? String(i.counted_qty) : "",
      ]),
    ),
  );

  function save(itemId: string) {
    const v = Number(local[itemId]);
    if (Number.isNaN(v)) {
      notify.warning("Cantidad inválida");
      return;
    }
    startTransition(async () => {
      const r = await recordCountedQtyAction(itemId, v);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      router.refresh();
    });
  }

  function complete() {
    startTransition(async () => {
      const r = await completeStockCountAction(countId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(`Conteo cerrado · ${r.adjustments} ajustes aplicados`);
      router.refresh();
    });
  }

  const filtered = filter
    ? items.filter(
        (i) =>
          i.product_name.toLowerCase().includes(filter.toLowerCase()) ||
          i.product_sku?.toLowerCase().includes(filter.toLowerCase()) ||
          i.product_barcode === filter,
      )
    : items;

  const totalCounted = items.filter((i) => i.counted_qty != null).length;
  const isOpen = initialStatus === "open";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filtrar por nombre, SKU o barcode"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground">
          Contados: {totalCounted} / {items.length}
        </span>
        {isOpen && (
          <Button
            onClick={complete}
            disabled={pending}
            variant="success"
            className="ml-auto gap-2"
          >
            <Check className="h-4 w-4" />
            {pending ? "Cerrando..." : "Cerrar conteo y aplicar ajustes"}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-right">Esperado</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
              {isOpen && <th className="px-3 py-2 text-right">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2">
                  <div className="font-semibold">{i.product_name}</div>
                  {(i.product_sku || i.product_barcode) && (
                    <div className="text-[11px] text-muted-foreground">
                      {i.product_sku && `SKU ${i.product_sku}`}
                      {i.product_sku && i.product_barcode && " · "}
                      {i.product_barcode && `Cód. ${i.product_barcode}`}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(i.expected_qty)}
                </td>
                <td className="px-3 py-2 text-right">
                  {isOpen ? (
                    <Input
                      type="number"
                      value={local[i.id] ?? ""}
                      onChange={(e) =>
                        setLocal((s) => ({ ...s, [i.id]: e.target.value }))
                      }
                      className="h-8 w-24 text-right text-sm"
                    />
                  ) : (
                    <span className="tabular-nums">
                      {i.counted_qty != null ? Number(i.counted_qty) : "—"}
                    </span>
                  )}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    i.diff != null
                      ? Number(i.diff) === 0
                        ? "text-emerald-600"
                        : Number(i.diff) > 0
                          ? "text-blue-600"
                          : "text-red-600"
                      : ""
                  }`}
                >
                  {i.diff != null
                    ? `${Number(i.diff) > 0 ? "+" : ""}${Number(i.diff)}`
                    : "—"}
                </td>
                {isOpen && (
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => save(i.id)}
                      disabled={pending}
                    >
                      Guardar
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
