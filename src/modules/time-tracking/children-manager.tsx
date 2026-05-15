"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Baby } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertChildAction,
  deleteChildAction,
  type ChildRow,
} from "./children-actions";

function ageAt(birthDate: string, on = new Date()): number {
  const b = new Date(birthDate);
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

export function ChildrenManager({ items }: { items: ChildRow[] }) {
  const children = items;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bd, setBd] = useState("");

  function submit() {
    if (!bd) {
      notify.warning("Indica fecha de nacimiento");
      return;
    }
    startTransition(async () => {
      const r = await upsertChildAction({
        child_name: name.trim() || null,
        birth_date: bd,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Hijo añadido");
      setOpen(false);
      setName("");
      setBd("");
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("¿Eliminar este registro?")) return;
    startTransition(async () => {
      const r = await deleteChildAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Eliminado");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Solo se guarda fecha de nacimiento (y nombre opcional). Esto sirve
        para validar permisos parentales hasta los 8 años del menor.
      </p>
      {children.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {children.map((c) => {
            const age = ageAt(c.birth_date);
            const eligible = age < 8;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Baby
                    className={`h-4 w-4 ${eligible ? "text-emerald-600" : "text-muted-foreground"}`}
                  />
                  <div>
                    <div className="font-semibold">
                      {c.child_name ?? "Sin nombre"}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {new Date(c.birth_date).toLocaleDateString("es-ES")} ·{" "}
                      {age} años{" "}
                      {eligible ? (
                        <span className="text-emerald-600">
                          (permiso parental disponible)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          (&gt;8 años, ya no aplica)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => remove(c.id)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open ? (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Nombre (opcional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha de nacimiento *</Label>
              <Input
                type="date"
                value={bd}
                onChange={(e) => setBd(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="success"
              onClick={submit}
              disabled={pending}
            >
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> Añadir hijo/a
        </Button>
      )}
    </div>
  );
}
