"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertClauseTemplateAction,
  deleteClauseTemplateAction,
  reorderClausesAction,
  type ClauseTemplate,
  type ClausePlanType,
} from "./actions";
import { RichTextarea } from "./rich-textarea";

const PLAN_LABEL: Record<ClausePlanType, string> = {
  cash: "Venta al contado",
  rental: "Alquiler",
  renting: "Renting (anexo financiera)",
};

const PLAN_ORDER: ClausePlanType[] = ["cash", "rental", "renting"];

export function ClausesManager({ clauses }: { clauses: ClauseTemplate[] }) {
  const [editing, setEditing] = useState<{ kind: "new"; planType: ClausePlanType } | ClauseTemplate | null>(null);

  if (editing) {
    const initial = "kind" in editing ? null : editing;
    const planType = "kind" in editing ? editing.planType : editing.plan_type;
    return (
      <ClauseForm
        initial={initial}
        defaultPlanType={planType}
        onDone={() => {
          setEditing(null);
          location.reload();
        }}
      />
    );
  }

  // Agrupar por plan_type
  const byPlan: Record<ClausePlanType, ClauseTemplate[]> = {
    cash: [],
    rental: [],
    renting: [],
  };
  for (const c of clauses) byPlan[c.plan_type].push(c);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Cada tipo de contrato (Venta / Alquiler / Renting) tiene sus propias cláusulas. Se imprimen
        en el PDF en el orden indicado y quedan congeladas en cada contrato (los cambios aquí solo
        afectan a contratos futuros).
      </p>

      {PLAN_ORDER.map((plan) => (
        <Card key={plan}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{PLAN_LABEL[plan]} ({byPlan[plan].length})</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing({ kind: "new", planType: plan })}
              >
                <Plus className="h-4 w-4" /> Añadir cláusula
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byPlan[plan].length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                Sin cláusulas. Añade las que tu empresa use en contratos de {PLAN_LABEL[plan].toLowerCase()}.
              </div>
            ) : (
              <ul className="space-y-2">
                {byPlan[plan].map((c, idx) => (
                  <ClauseRow
                    key={c.id}
                    clause={c}
                    onEdit={() => setEditing(c)}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < byPlan[plan].length - 1}
                    onMove={(dir) => {
                      const ids = byPlan[plan].map((x) => x.id);
                      const target = dir === "up" ? idx - 1 : idx + 1;
                      [ids[idx], ids[target]] = [ids[target]!, ids[idx]!];
                      reorderClausesAction(plan, ids)
                        .then(() => location.reload())
                        .catch((err) =>
                          notify.error("Error", err instanceof Error ? err.message : String(err)),
                        );
                    }}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ClauseRow({
  clause,
  onEdit,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  clause: ClauseTemplate;
  onEdit: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: "up" | "down") => void;
}) {
  const [pending, startTransition] = useTransition();
  function remove() {
    if (!confirm(`¿Eliminar cláusula "${clause.title}"? (solo afecta a contratos futuros)`)) return;
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
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex shrink-0 flex-col gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            disabled={!canMoveUp}
            onClick={() => onMove("up")}
            aria-label="Subir"
            className="h-7 w-7"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canMoveDown}
            onClick={() => onMove("down")}
            aria-label="Bajar"
            className="h-7 w-7"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">#{clause.display_order}</Badge>
            <span className="font-semibold">{clause.title}</span>
            {!clause.is_active && <Badge variant="secondary">Inactiva</Badge>}
          </div>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">
            {clause.body}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending} aria-label="Eliminar">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function ClauseForm({
  initial,
  defaultPlanType,
  onDone,
}: {
  initial: ClauseTemplate | null;
  defaultPlanType: ClausePlanType;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    plan_type: (initial?.plan_type ?? defaultPlanType) as ClausePlanType,
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    display_order: initial?.display_order ?? 0,
  });

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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo de contrato</Label>
              <select
                value={form.plan_type}
                onChange={(e) => setForm({ ...form, plan_type: e.target.value as ClausePlanType })}
                className="h-12 w-full rounded-xl border border-border bg-card px-3 text-base"
              >
                {PLAN_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Orden de impresión</Label>
              <Input
                type="number"
                min={0}
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Garantía / Mantenimiento / Forma de pago…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Texto</Label>
            <RichTextarea
              id="body"
              required
              value={form.body}
              onChange={(v) => setForm({ ...form, body: v })}
              rows={10}
            />
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
