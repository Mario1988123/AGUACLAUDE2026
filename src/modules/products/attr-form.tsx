"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertAttributeSafeAction,
  listAttributeExtraCategories,
  setAttributeExtraCategoriesAction,
  type ProductAttribute,
} from "./attributes-actions";
import type { CategoryItem } from "./types";
import { toSnakeCase } from "@/shared/lib/slug";

// Solo tipos relevantes para una empresa sin conocimientos técnicos:
// fecha y dimensión han sido retirados (decisión usuario 2026-05-03).
export const TYPES: ProductAttribute["data_type"][] = ["text", "number", "boolean", "enum"];

export const TYPE_LABEL: Record<ProductAttribute["data_type"], string> = {
  text: "Texto libre",
  number: "Número",
  boolean: "Sí / No",
  enum: "Lista de opciones",
  dimension: "Dimensión",
  date: "Fecha",
};

/**
 * Formulario de alta/edición de un atributo de producto.
 *
 * Vive en el módulo `products` (no en `config`) a propósito: tanto la pantalla
 * de configuración (`config/products/attributes-config`) como el gestor de
 * categorías (`products/categories-manager`) lo reutilizan. Tenerlo aquí evita
 * que `products` dependa de `config` (rompería en círculo). Ver
 * AUDITORIA_GRAFOS_2026-06-09.md.
 */
export function AttrForm({
  initial,
  categories,
  units,
  onDone,
  forcedCategoryId,
}: {
  initial: ProductAttribute | null;
  categories: CategoryItem[];
  units: Array<{ code: string; label: string }>;
  onDone: () => void;
  /** Si se pasa, la categoría queda fijada y no se muestra el selector. */
  forcedCategoryId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    name: initial?.name ?? "",
    data_type: initial?.data_type ?? ("text" as ProductAttribute["data_type"]),
    unit: initial?.unit ?? "",
    category_id: forcedCategoryId ?? initial?.category_id ?? "",
    is_required: initial?.is_required ?? false,
    sort_order: initial?.sort_order ?? 0,
  });
  // Categorías EXTRA (además de la principal) a las que aplica el atributo.
  const [extraCats, setExtraCats] = useState<string[]>([]);
  useEffect(() => {
    if (initial?.id) {
      listAttributeExtraCategories(initial.id)
        .then(setExtraCats)
        .catch(() => setExtraCats([]));
    }
  }, [initial?.id]);
  const principalId = forcedCategoryId ?? form.category_id;
  function toggleExtra(id: string) {
    setExtraCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function setName(name: string) {
    // Auto-generar key desde nombre solo cuando es nuevo o si key sigue derivada
    setForm((f) => {
      const autoKey = toSnakeCase(name);
      const wasAuto = !initial && (!f.key || f.key === toSnakeCase(f.name));
      return {
        ...f,
        name,
        key: wasAuto ? autoKey : f.key,
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalKey = form.key || toSnakeCase(form.name);
    if (!finalKey) {
      notify.warning("El nombre es obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await upsertAttributeSafeAction({
        id: initial?.id,
        ...form,
        key: finalKey,
        category_id: (forcedCategoryId || form.category_id) || null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      // Guardar categorías EXTRA (excluyendo la principal). Solo si tenemos id.
      const attrId = r.id ?? initial?.id;
      if (attrId) {
        const extras = extraCats.filter((c) => c && c !== principalId);
        const er = await setAttributeExtraCategoriesAction(attrId, extras);
        if (!er.ok) {
          notify.error("Atributo guardado, pero falló asignar categorías extra", er.error);
          onDone();
          return;
        }
      }
      notify.success("Guardado");
      onDone();
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Caudal, Presión, Color..."
            />
            {form.key && (
              <p className="text-[10px] text-muted-foreground">
                Identificador interno: <code>{form.key}</code>
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Tipo de dato</Label>
              <select
                value={form.data_type}
                onChange={(e) =>
                  setForm({ ...form, data_type: e.target.value as ProductAttribute["data_type"] })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Unidad</Label>
              <Input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="L/min, bar, kg..."
                list="units-list"
              />
              <datalist id="units-list">
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.label}
                  </option>
                ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground">
                Selecciona del catálogo o escribe la tuya. Puedes añadir nuevas en la sección de
                arriba.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>
          {!forcedCategoryId && (
            <div className="space-y-1.5">
              <Label>Categoría aplicable</Label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Categorías ADICIONALES: el mismo atributo puede aplicar a varias.
              Ej: "micras" vale para flujo directo Y compacta. */}
          {categories.length > 0 && (
            <div className="space-y-1.5">
              <Label>También aplica a estas otras categorías (opcional)</Label>
              <p className="text-[11px] text-muted-foreground">
                Marca las categorías EXTRA en las que también quieras rellenar esta
                característica. La principal de arriba ya queda incluida.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {categories
                  .filter((c) => c.id !== principalId)
                  .map((c) => {
                    const on = extraCats.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleExtra(c.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_required}
              onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
              className="h-5 w-5"
            />
            <span className="text-sm font-semibold">Obligatorio en productos de su categoría</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : initial ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
