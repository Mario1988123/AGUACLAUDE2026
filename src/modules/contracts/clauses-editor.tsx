"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, ChevronUp, ChevronDown, Save, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { updateContractClausesAction } from "./actions";

interface Clause {
  title: string;
  body: string;
  display_order: number;
}

export function ContractClausesEditor({
  contractId,
  initial,
  canEdit,
}: {
  contractId: string;
  initial: Clause[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [clauses, setClauses] = useState<Clause[]>(
    initial.length > 0 ? initial.sort((a, b) => a.display_order - b.display_order) : [],
  );
  const [pending, startTransition] = useTransition();

  function add() {
    const max = clauses.reduce((m, c) => Math.max(m, c.display_order), 0);
    setClauses((cs) => [...cs, { title: "Nueva cláusula", body: "", display_order: max + 10 }]);
  }
  function update(idx: number, patch: Partial<Clause>) {
    setClauses((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function remove(idx: number) {
    setClauses((cs) => cs.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= clauses.length) return;
    setClauses((cs) => {
      const next = [...cs];
      [next[idx]!.display_order, next[target]!.display_order] = [
        next[target]!.display_order,
        next[idx]!.display_order,
      ];
      return next.sort((a, b) => a.display_order - b.display_order);
    });
  }
  function save() {
    startTransition(async () => {
      try {
        const normalized = clauses
          .sort((a, b) => a.display_order - b.display_order)
          .map((c, i) => ({ title: c.title.trim(), body: c.body.trim(), display_order: (i + 1) * 10 }))
          .filter((c) => c.title && c.body);
        await updateContractClausesAction(contractId, normalized);
        notify.success("Cláusulas guardadas");
        setEditing(false);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {clauses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin cláusulas. Por defecto se usarán las plantillas activas de la empresa.
          </p>
        ) : (
          <ul className="space-y-2">
            {clauses
              .sort((a, b) => a.display_order - b.display_order)
              .map((c, i) => (
                <li key={i} className="rounded-xl border border-border bg-card p-3">
                  <div className="text-sm font-bold uppercase text-primary">{c.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                </li>
              ))}
          </ul>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Editar cláusulas (este contrato)
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-primary bg-primary/5 p-3 text-xs text-muted-foreground">
        Estás editando las cláusulas <strong>de este contrato concreto</strong>. No afecta a las
        plantillas globales de la empresa.
      </div>
      {clauses.map((c, i) => (
        <div key={i} className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground">#{i + 1}</span>
            <Input
              value={c.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder="Título"
              className="flex-1"
            />
            <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={pending}>
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={pending}>
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => remove(i)} disabled={pending}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
          <Label className="text-xs">Texto</Label>
          <textarea
            value={c.body}
            onChange={(e) => update(i, { body: e.target.value })}
            rows={4}
            className="w-full rounded-xl border border-input bg-background p-2 text-sm"
          />
        </div>
      ))}
      <Button variant="outline" onClick={add} disabled={pending} className="w-full">
        <Plus className="h-4 w-4" /> Añadir cláusula
      </Button>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={() => setEditing(false)} disabled={pending}>
          <X className="h-4 w-4" /> Cancelar
        </Button>
        <Button onClick={save} disabled={pending} variant="success">
          <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
