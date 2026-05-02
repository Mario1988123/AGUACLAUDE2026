"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertClauseTemplateAction,
  deleteClauseTemplateAction,
  type ClauseTemplate,
} from "./actions";

const VARIABLES = [
  "{{customer_name}}",
  "{{customer_tax_id}}",
  "{{customer_address}}",
  "{{contract_total}}",
  "{{contract_monthly}}",
  "{{contract_duration}}",
  "{{product_list}}",
  "{{representative_name}}",
  "{{company_name}}",
  "{{date}}",
];

export function ClausesManager({ clauses }: { clauses: ClauseTemplate[] }) {
  const [editing, setEditing] = useState<ClauseTemplate | "new" | null>(null);

  if (editing) {
    return (
      <ClauseForm
        initial={editing === "new" ? null : editing}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {clauses.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Aún no hay cláusulas. Añade las que tu empresa usará en los contratos.
        </div>
      )}
      {clauses.map((c) => (
        <ClauseRow key={c.id} clause={c} onEdit={() => setEditing(c)} />
      ))}
      <Button onClick={() => setEditing("new")} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> Nueva cláusula
      </Button>
    </div>
  );
}

function ClauseRow({ clause, onEdit }: { clause: ClauseTemplate; onEdit: () => void }) {
  const [pending, startTransition] = useTransition();
  function remove() {
    if (!confirm(`¿Eliminar cláusula "${clause.title}"?`)) return;
    startTransition(async () => {
      try {
        await deleteClauseTemplateAction(clause.id);
        notify.success("Eliminada");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{clause.title}</span>
            <Badge variant="outline">#{clause.display_order}</Badge>
            {clause.is_required && <Badge variant="warning">Obligatoria</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{clause.body_template}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClauseForm({
  initial,
  onDone,
}: {
  initial: ClauseTemplate | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    key: initial?.key ?? "",
    title: initial?.title ?? "",
    body_template: initial?.body_template ?? "",
    display_order: initial?.display_order ?? 0,
    is_required: initial?.is_required ?? false,
  });

  function insertVar(v: string) {
    setForm((f) => ({ ...f, body_template: `${f.body_template}${v}` }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertClauseTemplateAction({ id: initial?.id, ...form });
        notify.success("Guardada");
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
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="key">Clave (interna)</Label>
              <Input
                id="key"
                required
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                placeholder="duracion, permanencia..."
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Texto (puedes usar variables)</Label>
            <textarea
              id="body"
              required
              rows={6}
              value={form.body_template}
              onChange={(e) => setForm({ ...form, body_template: e.target.value })}
              className="w-full rounded-xl border border-border bg-card p-3 text-sm font-mono"
            />
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => insertVar(v)}
                  className="rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Orden</Label>
              <Input
                type="number"
                min={0}
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 self-end rounded-xl border border-border bg-muted/30 p-3">
              <input
                type="checkbox"
                checked={form.is_required}
                onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
                className="h-5 w-5"
              />
              <span className="text-sm font-semibold">Obligatoria en todo contrato</span>
            </label>
          </div>

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
