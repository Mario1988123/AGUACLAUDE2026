"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { updateCategoryAction, deleteCategoryAction } from "./actions";
import { ImportSuggestedAttributesButton } from "./import-attributes-button";
import { AttrForm } from "@/modules/config/products/attributes-config";
import { KIND_LABEL, PRODUCT_KIND } from "./schemas";
import type { CategoryItem, ProductKind } from "./types";
import type { ProductAttribute } from "./attributes-actions";

interface Props {
  categories: CategoryItem[];
  attributes: ProductAttribute[];
  units: Array<{ code: string; label: string }>;
  /** Vinculaciones atributo↔categoría EXTRA (tabla puente). */
  attributeLinks?: Array<{ attribute_id: string; category_id: string }>;
}

const TYPE_LABEL: Record<ProductAttribute["data_type"], string> = {
  text: "Texto libre",
  number: "Número",
  boolean: "Sí / No",
  enum: "Lista de opciones",
  dimension: "Dimensión",
  date: "Fecha",
};

export function CategoriesManager({ categories, attributes, units, attributeLinks = [] }: Props) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no tienes categorías. Precarga del catálogo global o crea las tuyas abajo.
      </p>
    );
  }
  // Mapa categoría → ids de atributos vinculados como EXTRA (vía puente).
  const extraByCategory = new Map<string, Set<string>>();
  for (const l of attributeLinks) {
    const set = extraByCategory.get(l.category_id) ?? new Set<string>();
    set.add(l.attribute_id);
    extraByCategory.set(l.category_id, set);
  }
  return (
    <ul className="divide-y">
      {categories.map((c) => {
        const extraIds = extraByCategory.get(c.id) ?? new Set<string>();
        const attrs = attributes.filter(
          (a) => a.category_id === c.id || extraIds.has(a.id),
        );
        return (
          <CategoryRow
            key={c.id}
            category={c}
            categories={categories}
            attributes={attrs}
            extraIds={extraIds}
            units={units}
          />
        );
      })}
    </ul>
  );
}

function CategoryRow({
  category: c,
  categories,
  attributes,
  extraIds,
  units,
}: {
  category: CategoryItem;
  categories: CategoryItem[];
  attributes: ProductAttribute[];
  extraIds: Set<string>;
  units: Array<{ code: string; label: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [showAttrs, setShowAttrs] = useState(false);
  const [addingAttr, setAddingAttr] = useState(false);
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  async function handleDelete() {
    const ok = await ask({
      message:
        "¿Borrar esta categoría? Si tiene productos, atributos o subcategorías, se desactivará en vez de borrarse (no se pierde nada).",
      confirmText: "Borrar / desactivar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteCategoryAction(c.id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(r.deactivated ? "Categoría desactivada (estaba en uso)" : "Categoría borrada");
      location.reload();
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{c.name}</div>
          <div className="text-xs text-muted-foreground">
            {KIND_LABEL[c.default_kind]}
            {c.parent_id && " · Subcategoría"}
            {c.cloned_from_global_id && " · Precargada del catálogo"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportSuggestedAttributesButton
            categoryId={c.id}
            isCloned={Boolean(c.cloned_from_global_id)}
          />
          {c.is_active ? (
            <Badge variant="success">Activa</Badge>
          ) : (
            <Badge variant="secondary">Inactiva</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAttrs((v) => !v)}
          >
            {showAttrs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Atributos ({attributes.length})
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setEditing((v) => !v)} title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDelete} disabled={pending} title="Borrar">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {editing && (
        <EditCategoryForm
          category={c}
          categories={categories}
          onDone={() => {
            setEditing(false);
            location.reload();
          }}
        />
      )}

      {showAttrs && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          {attributes.length === 0 && !addingAttr && (
            <p className="text-xs text-muted-foreground">
              Esta categoría aún no tiene características propias. Añade las que uses
              (caudal, micras, color…) y aparecerán al rellenar productos de esta categoría.
            </p>
          )}
          {attributes.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="font-medium">{a.name}</span>
              <Badge variant="outline">{TYPE_LABEL[a.data_type]}</Badge>
              {a.unit && <Badge variant="secondary">{a.unit}</Badge>}
              {a.is_required && <Badge variant="warning">Obligatorio</Badge>}
              {extraIds.has(a.id) && a.category_id !== c.id && (
                <Badge variant="secondary" title="Compartido desde otra categoría">
                  Compartido
                </Badge>
              )}
            </div>
          ))}
          {addingAttr ? (
            <AttrForm
              initial={null}
              categories={categories}
              units={units}
              forcedCategoryId={c.id}
              onDone={() => {
                setAddingAttr(false);
                location.reload();
              }}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAddingAttr(true)}>
              <Plus className="h-4 w-4" /> Nueva característica para esta categoría
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function EditCategoryForm({
  category: c,
  categories,
  onDone,
}: {
  category: CategoryItem;
  categories: CategoryItem[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: c.name,
    default_kind: c.default_kind,
    parent_id: c.parent_id ?? "",
    sort_order: c.sort_order ?? 0,
    is_active: c.is_active,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateCategoryAction(c.id, {
        name: form.name.trim(),
        default_kind: form.default_kind,
        parent_id: form.parent_id || null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Categoría actualizada");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border-2 border-primary bg-primary/5 p-4 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2">
        <Label>Nombre</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </div>
      <div className="space-y-1">
        <Label>Tipo por defecto</Label>
        <select
          value={form.default_kind}
          onChange={(e) => setForm({ ...form, default_kind: e.target.value as ProductKind })}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {PRODUCT_KIND.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Categoría padre</Label>
        <select
          value={form.parent_id}
          onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">— Ninguna (categoría principal) —</option>
          {categories
            .filter((o) => o.id !== c.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Orden</Label>
        <Input
          type="number"
          value={form.sort_order}
          onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
        />
      </div>
      <label className="flex items-center gap-2 sm:col-span-1">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          className="h-5 w-5"
        />
        <span className="text-sm font-semibold">Activa</span>
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
