"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { FichaCaracteristicas, type BloqueCaracteristicas } from "./ficha-caracteristicas";

/**
 * «Ficha técnica» como en la tarifa: tablas por grupo (nombre a la izquierda,
 * valor con unidad a la derecha) y, si es larga, «Ver más características
 * técnicas» para desplegar el resto.
 */
export function FichaTecnica({
  bloques,
  imagenMedidas,
  filasVisibles = 14,
}: {
  bloques: BloqueCaracteristicas[];
  imagenMedidas?: string | null;
  filasVisibles?: number;
}) {
  const [todo, setTodo] = useState(false);
  const total = bloques.reduce((s, b) => s + b.filas.length, 0);
  if (total === 0) return null;

  let quedan = filasVisibles;
  const recortados: BloqueCaracteristicas[] = [];
  for (const b of bloques) {
    if (quedan <= 0) break;
    recortados.push({ ...b, filas: b.filas.slice(0, quedan) });
    quedan -= b.filas.length;
  }
  const hayMas = total > filasVisibles;

  return (
    <div className="space-y-4">
      <FichaCaracteristicas bloques={todo || !hayMas ? bloques : recortados} imagenMedidas={imagenMedidas} />
      {hayMas && (
        <button
          type="button"
          onClick={() => setTodo((v) => !v)}
          aria-expanded={todo}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border bg-card text-sm font-semibold text-primary hover:bg-muted"
        >
          {todo ? (
            <>
              Ver menos <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              Ver más características técnicas ({total - filasVisibles}) <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
