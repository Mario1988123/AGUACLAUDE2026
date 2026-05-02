"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { upsertAttributeAction, type ProductAttribute } from "@/modules/products/attributes-actions";
import type { CategoryItem } from "@/modules/products/types";

const TYPES: ProductAttribute["data_type"][] = [
  "text",
  "number",
  "boolean",
  "enum",
  "dimension",
  "date",
];

const TYPE_LABEL: Record<ProductAttribute["data_type"], string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sí/No",
  enum: "Lista",
  dimension: "Dimensión",
  date: "Fecha",
};

interface Props {
  attributes: ProductAttribute[];
  categories: CategoryItem[];
}

export function AttributesConfig({ attributes, categories }: Props) {
  const [editing, setEditing] = useState<ProductAttribute | "new" | null>(null);
  const catName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? "?" : "Todas";

  if (editing) {
    return (
      <AttrForm
        initial={editing === "new" ? null : editing}
        categories={categories}
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

function AttrForm({
  initial,
  categories,
  onDone,
}: {
  initial: ProductAttribute | null;
  categories: CategoryItem[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    name: initial?.name ?? "",
    data_type: initial?.data_type ?? "text",
    unit: initial?.unit ?? "",
    category_id: initial?.category_id ?? "",
    is_required: initial?.is_required ?? false,
    sort_order: initial?.sort_order ?? 0,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertAttributeAction({
          id: initial?.id,
          ...form,
          category_id: form.category_id || null,
        });
        notify.success("Guardado");
        onDone();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Caudal, Presión..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key">Clave (snake_case) *</Label>
              <Input
                id="key"
                required
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="flow_lpm"
              />
            </div>
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
              />
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
