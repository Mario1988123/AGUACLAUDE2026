"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  listSuggestedAttributesForCategory,
  importGlobalAttributesForCategoryAction,
  type SuggestedAttribute,
} from "./suggested-attributes-actions";

interface Props {
  categoryId: string;
  /** True si la categoría tiene cloned_from_global_id (i.e. fue importada). */
  isCloned: boolean;
}

/**
 * Botón que, para una categoría clonada del catálogo global del sector agua,
 * permite precargar los atributos sugeridos a la empresa. Muestra cuántos
 * son nuevos y cuántos ya están.
 *
 * Si la categoría NO está clonada (la creó la empresa a mano), no aparece
 * porque no hay seed global vinculado.
 */
export function ImportSuggestedAttributesButton({
  categoryId,
  isCloned,
}: Props) {
  const [suggested, setSuggested] = useState<SuggestedAttribute[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  // Cargar conteo (no toda la lista pintada, solo para el badge del botón).
  useEffect(() => {
    if (!isCloned) return;
    let alive = true;
    setLoading(true);
    listSuggestedAttributesForCategory(categoryId)
      .then((res) => {
        if (alive) setSuggested(res);
      })
      .catch(() => {
        if (alive) setSuggested([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [categoryId, isCloned]);

  function handleImport() {
    startTransition(async () => {
      const r = await importGlobalAttributesForCategoryAction(categoryId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      if (r.inserted === 0 && r.skipped > 0) {
        notify.success(
          "Atributos ya precargados",
          "No quedaban atributos sugeridos por añadir.",
        );
      } else {
        notify.success(
          "Atributos precargados",
          `${r.inserted} nuevos, ${r.skipped} ya estaban.`,
        );
      }
      // Refrescar el contador
      const next = await listSuggestedAttributesForCategory(categoryId);
      setSuggested(next);
    });
  }

  if (!isCloned) return null;
  if (loading) {
    return (
      <span className="text-xs text-muted-foreground">
        Cargando sugeridos...
      </span>
    );
  }
  if (!suggested || suggested.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">Sin sugeridos</span>
    );
  }

  const pendingCount = suggested.filter((s) => !s.already_in_company).length;
  const alreadyCount = suggested.length - pendingCount;

  if (pendingCount === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {alreadyCount} ya precargados
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleImport}
        disabled={pending}
      >
        {pending ? "Precargando..." : `Precargar ${pendingCount} atributos`}
      </Button>
      {alreadyCount > 0 && (
        <span className="text-[11px] text-muted-foreground">
          ({alreadyCount} ya estaban)
        </span>
      )}
    </div>
  );
}
