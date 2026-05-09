"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateProductAction, toggleShowInCalculatorAction } from "./actions";

export function ProductEditButton({
  productId,
  initial,
  categories,
}: {
  productId: string;
  initial: {
    name: string;
    category_id: string | null;
    internal_reference: string | null;
    supplier_reference: string | null;
    short_description: string | null;
    long_description: string | null;
    dim_width_mm: number | null;
    dim_height_mm: number | null;
    dim_depth_mm: number | null;
    weight_grams: number | null;
    stock_managed: boolean;
    stock_min: number | null;
    show_in_calculator: boolean;
  };
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial.name,
    category_id: initial.category_id ?? "",
    internal_reference: initial.internal_reference ?? "",
    supplier_reference: initial.supplier_reference ?? "",
    short_description: initial.short_description ?? "",
    long_description: initial.long_description ?? "",
    dim_w: initial.dim_width_mm?.toString() ?? "",
    dim_h: initial.dim_height_mm?.toString() ?? "",
    dim_d: initial.dim_depth_mm?.toString() ?? "",
    weight: initial.weight_grams?.toString() ?? "",
    stock_managed: initial.stock_managed,
    stock_min: initial.stock_min?.toString() ?? "0",
    show_in_calculator: initial.show_in_calculator,
  });

  function save() {
    if (!form.name.trim()) {
      notify.warning("El nombre es obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await updateProductAction(productId, {
        name: form.name,
        category_id: form.category_id || null,
        internal_reference: form.internal_reference || null,
        supplier_reference: form.supplier_reference || null,
        short_description: form.short_description || null,
        long_description: form.long_description || null,
        dim_width_mm: form.dim_w ? Number(form.dim_w) : null,
        dim_height_mm: form.dim_h ? Number(form.dim_h) : null,
        dim_depth_mm: form.dim_d ? Number(form.dim_d) : null,
        weight_grams: form.weight ? Number(form.weight) : null,
        stock_managed: form.stock_managed,
        stock_min: form.stock_min ? Number(form.stock_min) : 0,
        show_in_calculator: form.show_in_calculator,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Producto actualizado");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm" className="gap-2">
        <Pencil className="h-3.5 w-3.5" /> Editar producto
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl my-8 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 space-y-4">
              <h2 className="text-lg font-bold">Editar producto</h2>

              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div className="space-y-1">
                <Label>Categoría</Label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="">Sin categoría</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Ref. interna</Label>
                  <Input
                    value={form.internal_reference}
                    onChange={(e) => setForm({ ...form, internal_reference: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Ref. proveedor</Label>
                  <Input
                    value={form.supplier_reference}
                    onChange={(e) => setForm({ ...form, supplier_reference: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Descripción corta</Label>
                <Input
                  value={form.short_description}
                  onChange={(e) => setForm({ ...form, short_description: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label>Descripción larga</Label>
                <textarea
                  value={form.long_description}
                  onChange={(e) => setForm({ ...form, long_description: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label>Ancho (mm)</Label>
                  <Input
                    type="number"
                    value={form.dim_w}
                    onChange={(e) => setForm({ ...form, dim_w: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Alto (mm)</Label>
                  <Input
                    type="number"
                    value={form.dim_h}
                    onChange={(e) => setForm({ ...form, dim_h: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Profundidad (mm)</Label>
                  <Input
                    type="number"
                    value={form.dim_d}
                    onChange={(e) => setForm({ ...form, dim_d: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Peso (g)</Label>
                  <Input
                    type="number"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                💡 El coste del producto se calcula automáticamente como{" "}
                <strong>coste medio ponderado (CMP)</strong> a partir de las
                facturas de compra registradas. Ya no se introduce a mano.
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-border p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.stock_managed}
                    onChange={(e) =>
                      setForm({ ...form, stock_managed: e.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-sm">Stock gestionado</span>
                </label>
                <div className="space-y-1">
                  <Label>Stock mínimo</Label>
                  <Input
                    type="number"
                    value={form.stock_min}
                    onChange={(e) => setForm({ ...form, stock_min: e.target.value })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.show_in_calculator}
                  onChange={(e) =>
                    setForm({ ...form, show_in_calculator: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <div>
                  <div className="text-sm font-bold text-blue-900">
                    📊 Mostrar en la Calculadora de ahorro
                  </div>
                  <div className="text-xs text-blue-800">
                    Si está marcado, aparece como opción cuando el comercial use el wizard.
                  </div>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3 sticky bottom-0">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending} variant="success">
                {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Toggle inline rápido del flag "show_in_calculator". Para usar en el
 * listado de /productos sin abrir el modal.
 */
export function ShowInCalculatorToggle({
  productId,
  value,
}: {
  productId: string;
  value: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(value);

  function toggle() {
    const next = !checked;
    setChecked(next); // optimista
    startTransition(async () => {
      const r = await toggleShowInCalculatorAction(productId, next);
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        setChecked(value); // rollback
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={checked ? "Quitar de la calculadora" : "Mostrar en calculadora"}
      className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-bold uppercase tracking-wider ${
        checked
          ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      📊 {checked ? "En calculadora" : "Sin calculadora"}
    </button>
  );
}
