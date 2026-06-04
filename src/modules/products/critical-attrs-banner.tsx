"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/shared/hooks/use-toast";
import {
  dismissCriticalAttributesAlertAction,
  type CriticalAttributeMissing,
} from "./critical-attrs-actions";

interface Props {
  productId: string;
  missing: CriticalAttributeMissing[];
}

/**
 * Banner amarillo arriba en la ficha del producto. Lo ve solo admin
 * (la action server-side ya filtra). Lista hasta 6 atributos críticos
 * sin rellenar. Botón "Visto" guarda dismissal por usuario.
 */
export function CriticalAttributesBanner({ productId, missing }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed || missing.length === 0) return null;

  function handleDismiss() {
    startTransition(async () => {
      const r = await dismissCriticalAttributesAlertAction(productId);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setDismissed(true);
      notify.success("Aviso descartado");
      router.refresh();
    });
  }

  const visible = missing.slice(0, 6);
  const extra = missing.length - visible.length;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-amber-900">
            ⚠ Ficha técnica incompleta
          </h4>
          <p className="mt-1 text-xs text-amber-800">
            Faltan datos clave de esta categoría para que la ficha técnica
            quede profesional. Rellénalos en la sección de atributos. El PDF
            se sigue generando, pero algunos campos importantes saldrán vacíos.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {visible.map((m) => (
              <li
                key={m.attribute_id}
                className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300"
              >
                {m.attribute_name}
                {m.unit ? ` (${m.unit})` : ""}
              </li>
            ))}
            {extra > 0 && (
              <li className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300">
                +{extra} más
              </li>
            )}
          </ul>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={pending}
          className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "..." : "Visto"}
        </button>
      </div>
    </div>
  );
}
