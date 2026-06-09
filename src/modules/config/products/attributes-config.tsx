"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertAttributeSafeAction,
  listAttributeExtraCategories,
  setAttributeExtraCategoriesAction,
  type ProductAttribute,
} from "@/modules/products/attributes-actions";
import type { CategoryItem } from "@/modules/products/types";
import { toSnakeCase } from "@/shared/lib/slug";

// Solo tipos relevantes para una empresa sin conocimientos técnicos:
// fecha y dimensión han sido retirados (decisión usuario 2026-05-03).
const TYPES: ProductAttribute["data_type"][] = ["text", "number", "boolean", "enum"];

const TYPE_LABEL: Record<ProductAttribute["data_type"], string> = {
  text: "Texto libre",
  number: "Número",
  boolean: "Sí / No",
  enum: "Lista de opciones",
  dimension: "Dimensión",
  date: "Fecha",
};

interface Props {
  attributes: ProductAttribute[];
  categories: CategoryItem[];
  units?: Array<{ code: string; label: string }>;
}

export function AttributesConfig({ attributes, categories, units = [] }: Props) {
  const [editing, setEditing] = useState<ProductAttribute | "new" | null>(null);
  const catName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? "?" : "Todas";

  if (editing) {
    return (
      <AttrForm
        initial={editing === "new" ? null : editing}
        categories={categories}
        units={units}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {attributes.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin atributos definidos. Crea los que tu empresa usa (caudal, presión, dimensiones…).
        </div>
      )}
      {attributes.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{a.name}</span>
              <Badge variant="outline">{TYPE_LABEL[a.data_type]}</Badge>
              {a.unit && <Badge variant="secondary">{a.unit}</Badge>}
              {a.is_required && <Badge variant="warning">Obligatorio</Badge>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5">{a.key}</code> · Categoría:{" "}
              {catName(a.category_id)}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setEditing(a)}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button onClick={() => setEditing("new")} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> Nuevo atributo
      </Button>
    </div>
  );
}

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
