"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { createProductAction } from "./actions";
import { KIND_LABEL, PRODUCT_KIND } from "./schemas";
import type { CategoryItem } from "./types";

export function ProductCreateForm({ categories }: { categories: CategoryItem[] }) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createProductAction(fd);
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
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Datos básicos
        </legend>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Nombre *</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kind">Tipo</Label>
          <select
            id="kind"
            name="kind"
            defaultValue="equipment"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            {PRODUCT_KIND.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="category_id">Categoría</Label>
          <select
            id="category_id"
            name="category_id"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="internal_reference">Referencia interna</Label>
          <Input id="internal_reference" name="internal_reference" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier_reference">Referencia proveedor</Label>
          <Input id="supplier_reference" name="supplier_reference" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="short_description">Descripción corta</Label>
          <Input id="short_description" name="short_description" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Dimensiones (mm) — necesarias para ficha técnica
        </legend>
        <div className="space-y-2">
          <Label htmlFor="dim_width_mm">Ancho</Label>
          <Input id="dim_width_mm" name="dim_width_mm" type="number" min={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dim_height_mm">Alto</Label>
          <Input id="dim_height_mm" name="dim_height_mm" type="number" min={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dim_depth_mm">Fondo</Label>
          <Input id="dim_depth_mm" name="dim_depth_mm" type="number" min={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="weight_grams">Peso (g)</Label>
          <Input id="weight_grams" name="weight_grams" type="number" min={0} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Costes (solo admin) y stock
        </legend>
        <div className="space-y-2">
          <Label htmlFor="cost_cents">Coste (céntimos)</Label>
          <Input id="cost_cents" name="cost_cents" type="number" min={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier_price_cents">Precio proveedor (cts)</Label>
          <Input
            id="supplier_price_cents"
            name="supplier_price_cents"
            type="number"
            min={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="stock_min">Stock mínimo</Label>
          <Input id="stock_min" name="stock_min" type="number" min={0} defaultValue={0} />
        </div>
        <div className="flex items-center gap-2 sm:col-span-3">
          <input
            id="stock_managed"
            name="stock_managed"
            type="checkbox"
            defaultChecked
            className="h-4 w-4"
          />
          <Label htmlFor="stock_managed" className="cursor-pointer">
            Controlar stock de este producto
          </Label>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="col-span-full text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Plan precio inicial (contado) — opcional
        </legend>
        <div className="space-y-2">
          <Label htmlFor="cash_total_cents">PVP (céntimos)</Label>
          <Input id="cash_total_cents" name="cash_total_cents" type="number" min={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash_min_authorized_cents">Mín. comercial (cts)</Label>
          <Input
            id="cash_min_authorized_cents"
            name="cash_min_authorized_cents"
            type="number"
            min={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash_absolute_min_cents">Mín. absoluto (cts)</Label>
          <Input
            id="cash_absolute_min_cents"
            name="cash_absolute_min_cents"
            type="number"
            min={0}
          />
        </div>
        <p className="col-span-3 text-xs text-muted-foreground">
          Mínimo comercial: precio que el comercial puede vender sin pedir aprobación. Mínimo
          absoluto: precio mínimo con aprobación de director/admin (decisión 1.6).
        </p>
      </fieldset>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href="/productos">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}
