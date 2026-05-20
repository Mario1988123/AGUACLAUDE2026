"use client";

import { useState } from "react";
import { ContractBulkToolbar } from "./bulk-toolbar";

/**
 * Wrapper cliente para añadir bulk selection a la tabla de contratos.
 * Recibe los `ids` válidos de selección y renderiza la toolbar arriba.
 *
 * Modo de uso simple: el padre RSC pasa `<SelectableContractsControl ids={...}>`
 * y dentro renderiza checkboxes que llaman a `onToggle(id)`.
 *
 * Para esta primera versión (decisión 2026-05-20) el control de
 * selección es solo via "Seleccionar todos" / "Limpiar". Marcado fino
 * por fila vendrá cuando refactoricemos la tabla de contratos.
 */
export function ContractBulkSelectAllButton({
  allIds,
}: {
  allIds: string[];
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const selectAll = () => setSelected(allIds);
  const clear = () => setSelected([]);

  return (
    <>
      <ContractBulkToolbar selectedIds={selected} onClear={clear} />
      {selected.length === 0 && allIds.length > 0 && (
        <button
          type="button"
          onClick={selectAll}
          className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
        >
          Seleccionar todos los filtrados ({allIds.length})
        </button>
      )}
    </>
  );
}
