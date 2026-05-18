"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertTagAction,
  deleteTagAction,
  type CustomerTag,
} from "./tags-actions";

const COLORS: Array<{ value: string; bg: string }> = [
  { value: "slate", bg: "bg-slate-200" },
  { value: "red", bg: "bg-red-200" },
  { value: "amber", bg: "bg-amber-200" },
  { value: "emerald", bg: "bg-emerald-200" },
  { value: "blue", bg: "bg-blue-200" },
  { value: "violet", bg: "bg-violet-200" },
  { value: "pink", bg: "bg-pink-200" },
];

const COLOR_BADGE: Record<string, string> = {
  slate: "bg-slate-100 text-slate-900",
  red: "bg-red-100 text-red-900",
  amber: "bg-amber-100 text-amber-900",
  emerald: "bg-emerald-100 text-emerald-900",
  blue: "bg-blue-100 text-blue-900",
  violet: "bg-violet-100 text-violet-900",
  pink: "bg-pink-100 text-pink-900",
};

export function TagsCatalogManager({ initial }: { initial: CustomerTag[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<CustomerTag | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("slate");
  const ask = useConfirm();

  function startEdit(t: CustomerTag | "new") {
    setEditing(t);
    if (t === "new") {
      setLabel("");
      setColor("slate");
    } else {
      setLabel(t.label);
      setColor(t.color);
    }
  }

  function save() {
    if (label.trim().length < 1) {
      notify.warning("Pon una etiqueta");
      return;
    }
    startTransition(async () => {
      const r = await upsertTagAction({
        id: editing && editing !== "new" ? editing.id : null,
        label,
        color,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardada");
      setEditing(null);
      router.refresh();
    });
  }

  async function remove(t: CustomerTag) {
    const ok = await ask({
      message: `¿Eliminar la etiqueta "${t.label}"? Se quitará de todos los clientes que la tengan.`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteTagAction(t.id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Eliminada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {initial.length === 0 && editing === null ? (
        <p className="rounded-xl border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          Sin etiquetas. Crea la primera (ej. VIP, Conflictivo, Recomendador).
        </p>
      ) : (
        <ul className="space-y-2">
          {initial.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-sm font-semibold ${COLOR_BADGE[t.color]}`}
              >
                {t.label}
              </span>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => startEdit(t)}
                  aria-label="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(t)}
                  disabled={pending}
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Etiqueta</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej. VIP"
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`h-7 w-7 rounded-full ${c.bg} ${color === c.value ? "ring-2 ring-primary ring-offset-2" : ""}`}
                    aria-label={c.value}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <Button onClick={() => startEdit("new")} variant="outline" className="w-full">
          <Plus className="h-4 w-4" /> Nueva etiqueta
        </Button>
      )}
    </div>
  );
}
