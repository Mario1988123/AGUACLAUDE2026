"use client";
/**
 * Gestor del catálogo de tags de productos en /configuracion/productos.
 * Permite al admin crear, renombrar, recolorear y desactivar tags que luego
 * se usan en `products.tags` para etiquetar productos.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  createTagCatalogAction,
  updateTagCatalogAction,
  type ProductTagCatalogItem,
} from "./tags-actions";

interface Props {
  initial: ProductTagCatalogItem[];
  /** Solo admin escribe; nivel 2-3 ve listado sin botones. */
  canEdit: boolean;
}

const DEFAULT_COLORS = [
  "#4880FF",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#A855F7",
  "#0EA5E9",
  "#EC4899",
  "#14B8A6",
];

function isValidHex(s: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(s.trim());
}

export function TagsCatalogManager({ initial, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tags, setTags] = useState<ProductTagCatalogItem[]>(initial);

  // Form crear nuevo
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_COLORS[0] ?? "#4880FF");

  function handleCreate() {
    if (!newName.trim()) {
      notify.error("Falta el nombre del tag");
      return;
    }
    if (!isValidHex(newColor)) {
      notify.error("Color no válido", "Usa hexadecimal de 6 dígitos (ej. #4880FF).");
      return;
    }
    startTransition(async () => {
      const r = await createTagCatalogAction({
        name: newName.trim(),
        color_hex: newColor,
      });
      if (!r.ok) {
        notify.error("No se pudo crear el tag", r.error);
        return;
      }
      notify.success("Tag creado");
      setNewName("");
      setNewColor(DEFAULT_COLORS[0] ?? "#4880FF");
      router.refresh();
    });
  }

  function handleUpdate(
    id: string,
    patch: { name?: string; color_hex?: string; is_active?: boolean },
  ) {
    if (patch.color_hex !== undefined && !isValidHex(patch.color_hex)) {
      notify.error("Color no válido");
      return;
    }
    startTransition(async () => {
      const r = await updateTagCatalogAction(id, patch);
      if (!r.ok) {
        notify.error("No se pudo actualizar el tag", r.error);
        return;
      }
      setTags((curr) =>
        curr.map((t) =>
          t.id === id
            ? {
                ...t,
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.color_hex !== undefined
                  ? { color_hex: patch.color_hex }
                  : {}),
                ...(patch.is_active !== undefined
                  ? { is_active: patch.is_active }
                  : {}),
              }
            : t,
        ),
      );
    });
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Crear tag nuevo
          </h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Nombre</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="bestseller, horeca, promo-junio..."
              />
            </div>
            <div className="space-y-1">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-1">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={
                      "h-8 w-8 rounded-md border-2 " +
                      (newColor === c
                        ? "border-foreground"
                        : "border-transparent")
                    }
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
              <Input
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? "Creando..." : "Crear tag"}
            </Button>
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Tags del catálogo ({tags.length})
        </h4>
        {tags.length === 0 ? (
          <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Aún no hay tags. {canEdit ? "Crea uno arriba para empezar a colorear los productos." : "Pídele al administrador que cree algunos."}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {tags.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <span
                  className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: `${t.color_hex}1A`,
                    borderColor: `${t.color_hex}55`,
                    color: t.color_hex,
                  }}
                >
                  {t.name}
                </span>
                {canEdit && (
                  <>
                    <Input
                      defaultValue={t.color_hex}
                      className="h-8 w-28 font-mono text-xs"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== t.color_hex && isValidHex(v))
                          handleUpdate(t.id, { color_hex: v });
                      }}
                    />
                    <Input
                      defaultValue={t.name}
                      className="h-8 flex-1"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t.name) handleUpdate(t.id, { name: v });
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={t.is_active}
                        onChange={(e) =>
                          handleUpdate(t.id, { is_active: e.target.checked })
                        }
                      />
                      Activo
                    </label>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
