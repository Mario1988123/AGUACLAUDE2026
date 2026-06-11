"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { cloneGlobalCategorySafeAction, createCategorySafeAction } from "./actions";
import { KIND_LABEL, PRODUCT_KIND } from "./schemas";

export function CloneCategoryButton({
  globalCategoryId,
  alreadyCloned,
}: {
  globalCategoryId: string;
  alreadyCloned: boolean;
}) {
  const [pending, startTransition] = useTransition();
  function handle() {
    startTransition(async () => {
      const r = await cloneGlobalCategorySafeAction(globalCategoryId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Categoría precargada");
    });
  }
  if (alreadyCloned) {
    return (
      <span className="text-xs text-muted-foreground">Ya precargada</span>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={pending}>
      {pending ? "..." : "Precargar"}
    </Button>
  );
}

export function CreateCategoryForm() {
  const [pending, startTransition] = useTransition();

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createCategorySafeAction(fd);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Categoría creada");
      (e.target as HTMLFormElement).reset();
      // Recargar para que la categoría nueva aparezca en la lista (y se le
      // puedan añadir atributos). Antes quedaba sin verse hasta refrescar.
      location.reload();
    });
  }

  return (
    <form onSubmit={handle} className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="cat_name">Nombre</Label>
        <Input id="cat_name" name="name" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cat_kind">Tipo por defecto</Label>
        <select
          id="cat_kind"
          name="default_kind"
          defaultValue="equipment"
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {PRODUCT_KIND.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending} className="sm:col-span-3">
        {pending ? "Creando..." : "Crear categoría"}
      </Button>
    </form>
  );
}
