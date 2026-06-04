"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  assignFilterToProductAction,
  updateFilterAssignmentAction,
  removeFilterAssignmentAction,
  type FilterAssignment,
} from "./filter-assignments-actions";
import { FILTER_TYPE_LABEL, type FilterType } from "./filters-constants";

interface AvailableFilter {
  id: string;
  name: string;
  filter_type: FilterType;
  lifespan_months: number | null;
  internal_reference: string | null;
}

interface Props {
  productId: string;
  productName: string;
  initial: FilterAssignment[];
  availableFilters: AvailableFilter[];
  /** Solo admin escribe. Nivel 2 y 3 ven los filtros asignados pero no editan. */
  canEdit: boolean;
}

/**
 * Panel de filtros asignados a un equipo, en la ficha del producto.
 * Permite añadir nuevos filtros del catálogo, indicar etapa y periodicidad,
 * editar y eliminar.
 */
export function ProductFiltersPanel({
  productId,
  productName,
  initial,
  availableFilters,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assignments, setAssignments] = useState<FilterAssignment[]>(initial);

  // Form de añadir
  const [addOpen, setAddOpen] = useState(false);
  const [newFilterId, setNewFilterId] = useState("");
  const [newStage, setNewStage] = useState("");
  const [newPeriod, setNewPeriod] = useState("");

  function resetAddForm() {
    setNewFilterId("");
    setNewStage("");
    setNewPeriod("");
  }

  function handleAdd() {
    if (!newFilterId) {
      notify.error("Selecciona un filtro");
      return;
    }
    startTransition(async () => {
      const r = await assignFilterToProductAction({
        productId,
        filterId: newFilterId,
        stagePosition: newStage ? Number(newStage) : null,
        replacementPeriodMonths: newPeriod ? Number(newPeriod) : null,
      });
      if (!r.ok) {
        notify.error("No se pudo asignar el filtro", r.error);
        return;
      }
      notify.success("Filtro asignado");
      resetAddForm();
      setAddOpen(false);
      router.refresh();
    });
  }

  function handleUpdate(
    assignmentId: string,
    patch: { stagePosition?: number | null; replacementPeriodMonths?: number | null },
  ) {
    startTransition(async () => {
      const r = await updateFilterAssignmentAction({
        assignmentId,
        productId,
        ...patch,
      });
      if (!r.ok) {
        notify.error("No se pudo actualizar la asignación", r.error);
        return;
      }
      setAssignments((curr) =>
        curr.map((a) =>
          a.id === assignmentId
            ? {
                ...a,
                stage_position:
                  patch.stagePosition !== undefined
                    ? patch.stagePosition
                    : a.stage_position,
                replacement_period_months:
                  patch.replacementPeriodMonths !== undefined
                    ? patch.replacementPeriodMonths
                    : a.replacement_period_months,
              }
            : a,
        ),
      );
    });
  }

  function handleRemove(assignmentId: string) {
    if (!confirm("¿Quitar este filtro del equipo?")) return;
    startTransition(async () => {
      const r = await removeFilterAssignmentAction({ assignmentId, productId });
      if (!r.ok) {
        notify.error("No se pudo quitar el filtro", r.error);
        return;
      }
      setAssignments((curr) => curr.filter((a) => a.id !== assignmentId));
      notify.success("Filtro quitado");
    });
  }

  // No mostramos los filtros ya asignados en el select de añadir
  const assignedIds = new Set(assignments.map((a) => a.filter_id));
  const selectable = availableFilters.filter((f) => !assignedIds.has(f.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Filtros y recambios que lleva <strong>{productName}</strong>. Sirve
          para calcular mantenimientos y predecir necesidades de stock.
        </p>
        {canEdit && !addOpen && (
          <Button onClick={() => setAddOpen(true)} disabled={pending}>
            + Añadir filtro
          </Button>
        )}
      </div>

      {canEdit && addOpen && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label>Filtro del catálogo</Label>
              <select
                value={newFilterId}
                onChange={(e) => setNewFilterId(e.target.value)}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— Selecciona —</option>
                {selectable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.internal_reference ? ` (${f.internal_reference})` : ""}
                    {" · "}
                    {FILTER_TYPE_LABEL[f.filter_type]}
                  </option>
                ))}
              </select>
              {selectable.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No quedan filtros sin asignar. Crea uno nuevo en{" "}
                  <Link
                    href={"/productos/filtros" as never}
                    className="underline"
                  >
                    /productos/filtros
                  </Link>
                  .
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Etapa</Label>
              <Input
                type="number"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                placeholder="1, 2, 3..."
              />
            </div>
            <div className="space-y-1">
              <Label>Cambio cada (meses)</Label>
              <Input
                type="number"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                placeholder="Si está vacío usa la vida útil del filtro"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAddOpen(false);
                resetAddForm();
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={pending}>
              {pending ? "Añadiendo..." : "Añadir"}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Etapa</th>
              <th className="px-4 py-3 text-left">Filtro</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Periodicidad</th>
              {canEdit && <th className="px-4 py-3 text-right">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {assignments.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 5 : 4}
                  className="p-8 text-center text-muted-foreground"
                >
                  Este equipo no tiene filtros asignados todavía.
                </td>
              </tr>
            ) : (
              [...assignments]
                .sort(
                  (a, b) => (a.stage_position ?? 99) - (b.stage_position ?? 99),
                )
                .map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <Input
                          type="number"
                          defaultValue={a.stage_position ?? ""}
                          onBlur={(e) => {
                            const val =
                              e.target.value === "" ? null : Number(e.target.value);
                            if (val !== a.stage_position)
                              handleUpdate(a.id, { stagePosition: val });
                          }}
                          className="h-8 w-20"
                        />
                      ) : (
                        a.stage_position ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={"/productos/filtros" as never}
                        className="font-medium text-primary hover:underline"
                      >
                        {a.filter_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {FILTER_TYPE_LABEL[a.filter_type as FilterType] ?? a.filter_type}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <Input
                          type="number"
                          defaultValue={a.replacement_period_months ?? ""}
                          placeholder="meses"
                          onBlur={(e) => {
                            const val =
                              e.target.value === "" ? null : Number(e.target.value);
                            if (val !== a.replacement_period_months)
                              handleUpdate(a.id, { replacementPeriodMonths: val });
                          }}
                          className="h-8 w-24"
                        />
                      ) : a.replacement_period_months ? (
                        `${a.replacement_period_months} meses`
                      ) : (
                        "—"
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemove(a.id)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Quitar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
