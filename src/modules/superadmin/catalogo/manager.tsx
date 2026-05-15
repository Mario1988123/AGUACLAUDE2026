"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, X, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertGlobalCategoryAction,
  deleteGlobalCategoryAction,
  upsertGlobalAttributeAction,
  deleteGlobalAttributeAction,
  upsertExternalModelAction,
  deleteExternalModelAction,
  getAttributeCategoryKeys,
  setAttributeCategoriesAction,
  type GlobalCategory,
  type GlobalAttribute,
  type GlobalExternalModel,
} from "./actions";
import { Tag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const DEFAULT_KIND_LABEL: Record<string, string> = {
  product: "Producto",
  service: "Servicio",
  consumable: "Consumible",
  spare_part: "Repuesto",
  equipment: "Equipo",
  filter: "Filtro",
  membrane: "Membrana",
  accessory: "Accesorio",
  extra: "Extra",
};

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Texto",
  number: "Número",
  integer: "Entero",
  boolean: "Sí/No",
  date: "Fecha",
  select: "Selección",
  multi_select: "Multi-selección",
};

export function CatalogoManager({
  categories,
  attributes,
  externalModels,
}: {
  categories: GlobalCategory[];
  attributes: GlobalAttribute[];
  externalModels: GlobalExternalModel[];
}) {
  return (
    <div className="space-y-6">
      <CategoriesPanel items={categories} />
      <AttributesPanel items={attributes} categories={categories} />
      <ExternalModelsPanel items={externalModels} />
    </div>
  );
}

function CategoriesPanel({ items }: { items: GlobalCategory[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Categorías globales ({items.length})</span>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nueva
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {creating && <CategoryForm onDone={() => setCreating(false)} />}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin categorías. Añade la primera.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((c) => (
              <CategoryRow key={c.id} item={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryRow({ item }: { item: GlobalCategory }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  async function handleDelete() {
    const ok = await ask({
      message: `¿Desactivar "${item.name_es}"?`,
      confirmText: "Desactivar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteGlobalCategoryAction(item.id);
        notify.success("Desactivada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  if (editing) return <CategoryForm initial={item} onDone={() => setEditing(false)} />;
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 ${
        !item.is_active ? "opacity-60" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{item.key}</code>
          <span className="font-semibold">{item.name_es}</span>
          <Badge variant="outline">{DEFAULT_KIND_LABEL[item.default_kind] ?? item.default_kind}</Badge>
          {!item.is_active && <Badge variant="secondary">Inactiva</Badge>}
        </div>
        {item.description_es && (
          <p className="mt-1 text-xs text-muted-foreground">{item.description_es}</p>
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={handleDelete} disabled={pending}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}

function CategoryForm({ initial, onDone }: { initial?: GlobalCategory; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    name_es: initial?.name_es ?? "",
    description_es: initial?.description_es ?? "",
    default_kind: initial?.default_kind ?? "equipment",
    sort_order: initial?.sort_order ?? 0,
  });

  function save() {
    if (!form.key.trim() || !form.name_es.trim()) {
      notify.warning("Key y nombre obligatorios");
      return;
    }
    startTransition(async () => {
      try {
        await upsertGlobalCategoryAction({ id: initial?.id, ...form });
        notify.success("Guardada");
        onDone();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="my-3 space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Key (slug interno)</Label>
          <Input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            disabled={!!initial}
            placeholder="osmosis"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nombre (es)</Label>
          <Input
            value={form.name_es}
            onChange={(e) => setForm({ ...form, name_es: e.target.value })}
            placeholder="Ósmosis"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo por defecto</Label>
          <select
            value={form.default_kind}
            onChange={(e) => setForm({ ...form, default_kind: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            {["equipment", "accessory", "consumable", "service"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Orden</Label>
          <Input
            type="number"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Descripción</Label>
          <Input
            value={form.description_es}
            onChange={(e) => setForm({ ...form, description_es: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function AttributesPanel({
  items,
  categories,
}: {
  items: GlobalAttribute[];
  categories: GlobalCategory[];
}) {
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Atributos globales ({items.length})</span>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {creating && <AttributeForm onDone={() => setCreating(false)} />}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin atributos.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((a) => (
              <AttributeRow key={a.id} item={a} categories={categories} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AttributeRow({
  item,
  categories,
}: {
  item: GlobalAttribute;
  categories: GlobalCategory[];
}) {
  const [editing, setEditing] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  async function handleDelete() {
    const ok = await ask({
      message: `¿Eliminar "${item.name_es}"?`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteGlobalAttributeAction(item.id);
        notify.success("Eliminado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  if (editing) return <AttributeForm initial={item} onDone={() => setEditing(false)} />;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{item.key}</code>
          <span className="font-semibold">{item.name_es}</span>
          <Badge variant="outline">{DATA_TYPE_LABEL[item.data_type] ?? item.data_type}</Badge>
          {item.unit && <span className="text-xs text-muted-foreground">({item.unit})</span>}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setCatOpen(true)}
        title="Asignar categorías"
      >
        <Tag className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={handleDelete} disabled={pending}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
      <AttributeCategoriesDialog
        open={catOpen}
        onOpenChange={setCatOpen}
        attributeKey={item.key}
        attributeName={item.name_es}
        categories={categories}
      />
    </li>
  );
}

function AttributeCategoriesDialog({
  open,
  onOpenChange,
  attributeKey,
  attributeName,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  attributeKey: string;
  attributeName: string;
  categories: GlobalCategory[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  // Cargar selección actual al abrir
  useState(() => {
    if (!open) return undefined;
    return undefined;
  });
  // Usamos efecto manual: cargar cuando abre
  if (open && !loading && selected.size === 0) {
    setLoading(true);
    getAttributeCategoryKeys(attributeKey)
      .then((keys) => setSelected(new Set(keys)))
      .finally(() => setLoading(false));
  }

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      try {
        await setAttributeCategoriesAction(attributeKey, Array.from(selected));
        notify.success("Asignación guardada");
        onOpenChange(false);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setSelected(new Set());
          setLoading(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categorías de &laquo;{attributeName}&raquo;</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Marca las categorías de producto en las que este atributo debe aparecer al editar
          una ficha.
        </p>
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {categories.map((c) => {
            const checked = selected.has(c.key);
            return (
              <label
                key={c.key}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-2.5 ${
                  checked ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.key)}
                  className="h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{c.name_es}</div>
                  <code className="text-xs text-muted-foreground">{c.key}</code>
                </div>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending} variant="success">
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttributeForm({ initial, onDone }: { initial?: GlobalAttribute; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    name_es: initial?.name_es ?? "",
    data_type: initial?.data_type ?? "text",
    unit: initial?.unit ?? "",
    sort_order: initial?.sort_order ?? 0,
  });

  function save() {
    if (!form.key.trim() || !form.name_es.trim()) {
      notify.warning("Key y nombre obligatorios");
      return;
    }
    startTransition(async () => {
      try {
        await upsertGlobalAttributeAction({ id: initial?.id, ...form });
        notify.success("Guardado");
        onDone();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="my-3 space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Key</Label>
          <Input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            disabled={!!initial}
            placeholder="flow_lpm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nombre (es)</Label>
          <Input
            value={form.name_es}
            onChange={(e) => setForm({ ...form, name_es: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo de dato</Label>
          <select
            value={form.data_type}
            onChange={(e) => setForm({ ...form, data_type: e.target.value })}
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            {["text", "number", "boolean", "enum"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unidad</Label>
          <Input
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="L/min"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}

function ExternalModelsPanel({ items }: { items: GlobalExternalModel[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Modelos de equipos externos ({items.length})</span>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {creating && <ExternalModelForm onDone={() => setCreating(false)} />}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin modelos. Aquí registras equipos de competencia que las empresas pueden referenciar.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((m) => (
              <ExternalModelRow key={m.id} item={m} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExternalModelRow({ item }: { item: GlobalExternalModel }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  async function handleDelete() {
    const ok = await ask({
      message: `¿Eliminar "${item.brand} ${item.model}"?`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteExternalModelAction(item.id);
        notify.success("Eliminado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  if (editing) return <ExternalModelForm initial={item} onDone={() => setEditing(false)} />;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{item.brand}</span>
          <span className="text-muted-foreground">·</span>
          <span>{item.model}</span>
        </div>
        {item.notes && <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>}
      </div>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={handleDelete} disabled={pending}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}

function ExternalModelForm({
  initial,
  onDone,
}: {
  initial?: GlobalExternalModel;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    brand: initial?.brand ?? "",
    model: initial?.model ?? "",
    notes: initial?.notes ?? "",
  });

  function save() {
    if (!form.brand.trim() || !form.model.trim()) {
      notify.warning("Marca y modelo obligatorios");
      return;
    }
    startTransition(async () => {
      try {
        await upsertExternalModelAction({ id: initial?.id, ...form });
        notify.success("Guardado");
        onDone();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="my-3 space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Marca</Label>
          <Input
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            placeholder="Aquariss"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Modelo</Label>
          <Input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="X-200"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Notas</Label>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
