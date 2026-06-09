"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import type { ProductAttribute } from "@/modules/products/attributes-actions";
import type { CategoryItem } from "@/modules/products/types";
// AttrForm vive en `products` para que `products` no dependa de `config`
// (rompería en círculo). Ver AUDITORIA_GRAFOS_2026-06-09.md.
import { AttrForm, TYPE_LABEL } from "@/modules/products/attr-form";

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
