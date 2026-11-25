"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, X, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertExternalModelSafeAction,
  deleteExternalModelSafeAction,
  type GlobalExternalModel,
} from "./actions";

/**
 * Pestaña «Modelos externos» del catálogo maestro: equipos de la competencia
 * que las empresas pueden referenciar. Movido tal cual de manager.tsx
 * (ExternalModelsPanel), con botones de 44 px.
 */

export function ModelosExternosGestor({ items }: { items: GlobalExternalModel[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Modelos de equipos externos ({items.length})</span>
          <Button className="h-11" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {creating && <ExternalModelForm onDone={() => setCreating(false)} />}
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
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
      const r = await deleteExternalModelSafeAction(item.id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Eliminado");
      router.refresh();
    });
  }
  if (editing) return <ExternalModelForm initial={item} onDone={() => setEditing(false)} />;
  return (
    <li className="border-border bg-card flex items-center gap-3 rounded-xl border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-semibold">{item.brand}</span>
          <span className="text-muted-foreground">·</span>
          <span>{item.model}</span>
        </div>
        {item.notes && <p className="text-muted-foreground mt-1 text-xs">{item.notes}</p>}
      </div>
      <Button size="icon" variant="ghost" onClick={() => setEditing(true)} aria-label="Editar">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleDelete}
        disabled={pending}
        aria-label="Eliminar"
      >
        <Trash2 className="text-destructive h-4 w-4" />
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
      const r = await upsertExternalModelSafeAction({ id: initial?.id, ...form });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardado");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="border-primary bg-primary/5 my-3 space-y-3 rounded-xl border-2 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        <Button variant="outline" onClick={onDone}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button onClick={save} disabled={pending}>
          <Save className="h-4 w-4" /> {pending ? "..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
