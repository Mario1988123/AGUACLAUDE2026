"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { changeStockStateAction } from "@/modules/customers/uninstall-actions";
import type { NonNewStockRow } from "./used-stock-actions";

const STATE_LABEL: Record<string, string> = {
  used: "Usado",
  damaged: "Dañado",
  refurbished: "Reacondicionado",
  reserved_trial: "Reservado prueba",
};

const STATE_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  used: "warning",
  damaged: "destructive",
  refurbished: "success",
  reserved_trial: "secondary",
};

export function UsedStockPanel({ rows }: { rows: NonNewStockRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeTo(
    rowId: string,
    newState: "new" | "used" | "damaged" | "refurbished",
  ) {
    startTransition(async () => {
      const r = await changeStockStateAction({
        warehouse_stock_id: rowId,
        new_state: newState,
      });
      if (r.ok) {
        notify.success(`Marcado como ${STATE_LABEL[newState] ?? newState}`);
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay equipos en estado distinto de «nuevo» en este almacén.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Cambia el estado de equipos usados, dañados o reacondicionados. El
        cambio queda como movimiento de ajuste en el histórico.
      </p>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-right">Cant.</th>
              <th className="px-3 py-2 text-right">Cambiar a</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{r.product_name}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATE_VARIANT[r.state] ?? "default"}>
                    {STATE_LABEL[r.state] ?? r.state}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">
                  {r.quantity}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    {r.state !== "refurbished" && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => changeTo(r.id, "refurbished")}
                        disabled={pending}
                      >
                        Reacondicionado
                      </Button>
                    )}
                    {r.state !== "used" && r.state !== "reserved_trial" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => changeTo(r.id, "used")}
                        disabled={pending}
                      >
                        Usado
                      </Button>
                    )}
                    {r.state !== "damaged" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => changeTo(r.id, "damaged")}
                        disabled={pending}
                      >
                        Dañado
                      </Button>
                    )}
                    {r.state !== "new" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => changeTo(r.id, "new")}
                        disabled={pending}
                        title="Vuelve a stock nuevo (raro — usar solo si fue un error)"
                      >
                        Nuevo
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
