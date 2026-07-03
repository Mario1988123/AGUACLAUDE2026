"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { CollapsibleCard } from "./collapsible-card";
import { setExtraTargetsAction } from "./extra-targets-actions";

/**
 * Panel para configurar de qué CATEGORÍAS y/o de qué EQUIPOS es extra este
 * producto. Solo se muestra si el producto tiene el rol `configurator_extra`.
 * Si no se marca ningún objetivo, el extra es GLOBAL (ofrecible en cualquier
 * equipo al montar un pack).
 */
export function ExtraTargetsPanel({
  productId,
  categories,
  equipmentProducts,
  initialCategoryIds,
  initialEquipmentIds,
}: {
  productId: string;
  categories: { id: string; name: string }[];
  equipmentProducts: { id: string; name: string }[];
  initialCategoryIds: string[];
  initialEquipmentIds: string[];
}) {
  const router = useRouter();
  const [cats, setCats] = useState<string[]>(initialCategoryIds);
  const [equips, setEquips] = useState<string[]>(initialEquipmentIds);
  const [pending, startTransition] = useTransition();

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function save() {
    startTransition(async () => {
      const r = await setExtraTargetsAction(productId, {
        categoryIds: cats,
        equipmentProductIds: equips,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Compatibilidad de extra guardada");
      router.refresh();
    });
  }

  const isGlobal = cats.length === 0 && equips.length === 0;

  return (
    <CollapsibleCard
      title={<span className="text-base">🧩 ¿De qué equipos es extra?</span>}
      defaultOpen={false}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Al montar un pack (equipo principal + extras), este producto se ofrecerá como
          extra de los equipos y categorías que marques aquí.{" "}
          {isGlobal ? (
            <strong className="text-amber-700">
              Ahora mismo no hay ninguno marcado: se ofrecerá en CUALQUIER equipo (global).
            </strong>
          ) : null}
        </p>

        <div className="space-y-2">
          <div className="text-sm font-bold">Por categoría</div>
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay categorías.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {categories.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={cats.includes(c.id)}
                    onChange={() => toggle(cats, setCats, c.id)}
                    className="h-4 w-4"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-bold">Por equipo concreto</div>
          {equipmentProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay equipos.</p>
          ) : (
            <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {equipmentProducts.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={equips.includes(p.id)}
                    onChange={() => toggle(equips, setEquips, p.id)}
                    className="h-4 w-4"
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending} variant="success" size="sm">
            <Save className="h-3.5 w-3.5" /> {pending ? "Guardando…" : "Guardar compatibilidad"}
          </Button>
        </div>
      </div>
    </CollapsibleCard>
  );
}
