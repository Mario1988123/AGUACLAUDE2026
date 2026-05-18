"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  Square,
  Power,
  PowerOff,
  Calculator,
  Tag,
  Percent,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { bulkProductsAction } from "./bulk-actions";

interface Props {
  selectedIds: string[];
  onClear: () => void;
  categories: Array<{ id: string; name: string }>;
}

export function ProductBulkToolbar({ selectedIds, onClear, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<
    | null
    | "category"
    | "price"
  >(null);
  const [categoryId, setCategoryId] = useState("");
  const [pct, setPct] = useState("");
  const [reason, setReason] = useState("");
  const ask = useConfirm();

  if (selectedIds.length === 0) return null;

  async function run(
    action:
      | "activate"
      | "deactivate"
      | "show_in_calculator_on"
      | "show_in_calculator_off"
      | "change_category"
      | "adjust_price_pct",
    extra?: Record<string, unknown>,
  ) {
    const labels: Record<typeof action, string> = {
      activate: "activar",
      deactivate: "desactivar",
      show_in_calculator_on: "incluir en calculadora",
      show_in_calculator_off: "ocultar de calculadora",
      change_category: "cambiar categoría",
      adjust_price_pct: `ajustar precio ${pct}%`,
    };
    const ok = await ask({
      title: `Bulk · ${labels[action]}`,
      message: `Se aplicará a ${selectedIds.length} productos seleccionados. ¿Continuar?`,
      confirmText: "Aplicar",
      variant:
        action === "deactivate" || action === "adjust_price_pct"
          ? "destructive"
          : "default",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await bulkProductsAction({
        product_ids: selectedIds,
        action,
        ...extra,
      });
      if (!r.ok) {
        notify.error("No se pudo aplicar", r.error);
        return;
      }
      notify.success(`Aplicado a ${r.affected} productos`);
      setOpen(null);
      setCategoryId("");
      setPct("");
      setReason("");
      onClear();
      router.refresh();
    });
  }

  return (
    <div className="sticky top-2 z-10 space-y-2 rounded-2xl border-2 border-primary bg-primary/10 p-3 shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <CheckSquare className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold text-primary">
          {selectedIds.length} productos seleccionados
        </span>
        <Button onClick={() => run("activate")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <Power className="h-3 w-3" /> Activar
        </Button>
        <Button onClick={() => run("deactivate")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <PowerOff className="h-3 w-3" /> Desactivar
        </Button>
        <Button onClick={() => run("show_in_calculator_on")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <Calculator className="h-3 w-3" /> En calculadora
        </Button>
        <Button onClick={() => run("show_in_calculator_off")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <Calculator className="h-3 w-3" /> Quitar calc
        </Button>
        <Button onClick={() => setOpen(open === "category" ? null : "category")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <Tag className="h-3 w-3" /> Categoría…
        </Button>
        <Button onClick={() => setOpen(open === "price" ? null : "price")} disabled={pending} size="sm" variant="outline" className="gap-1">
          <Percent className="h-3 w-3" /> Precio ±%…
        </Button>
        <Button onClick={onClear} disabled={pending} size="sm" variant="ghost">
          Limpiar selección
        </Button>
      </div>
      {open === "category" && (
        <div className="rounded-xl border bg-card p-3 space-y-2">
          <Label className="text-xs">Nueva categoría</Label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">— Sin categoría —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => run("change_category", { category_id: categoryId || null })}
              disabled={pending}
            >
              Aplicar
            </Button>
          </div>
        </div>
      )}
      {open === "price" && (
        <div className="rounded-xl border bg-card p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Porcentaje (-90 a +1000)</Label>
              <Input
                type="number"
                step="0.5"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                placeholder="ej. -10 o +5"
              />
            </div>
            <div>
              <Label className="text-xs">Motivo</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ajuste IPC anual"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Modifica cash_price_cents en el % indicado. Registra el cambio
            en product_price_history para cada producto.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                run("adjust_price_pct", {
                  adjust_pct: Number(pct),
                  reason: reason.trim() || undefined,
                })
              }
              disabled={pending || !pct || isNaN(Number(pct))}
            >
              Aplicar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente auxiliar para checkbox individual en cada fila del listado
export function ProductCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-primary"
    >
      {checked ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
    </button>
  );
}
