"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertProductFilterAction,
  deleteProductFilterAction,
  type ProductFilterItem,
} from "./filters-actions";
import { FILTER_TYPE_LABEL, type FilterType } from "./filters-constants";

interface Props {
  filters: ProductFilterItem[];
  /** Solo admin escribe; nivel 2-3 ve listado pero no crea/edita. */
  canEdit: boolean;
}

const FILTER_TYPES: FilterType[] = [
  "sediment",
  "gac",
  "cto",
  "membrane",
  "postcarbon",
  "remineralizer",
  "softener_resin",
  "uv_lamp",
  "uf",
  "other",
];

interface EditState {
  open: boolean;
  filter: Partial<ProductFilterItem>;
}

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function FiltersListClient({ filters, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<EditState>({ open: false, filter: {} });
  const [typeFilter, setTypeFilter] = useState<FilterType | "">("");
  const [search, setSearch] = useState("");

  const visible = filters.filter((f) => {
    if (typeFilter && f.filter_type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack =
        `${f.name} ${f.internal_reference ?? ""} ${f.manufacturer_name ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  function openCreate() {
    setState({
      open: true,
      filter: {
        name: "",
        filter_type: "other",
        stock_managed: true,
        stock_min: 0,
        is_active: true,
      },
    });
  }

  function openEdit(f: ProductFilterItem) {
    setState({ open: true, filter: { ...f } });
  }

  function close() {
    setState({ open: false, filter: {} });
  }

  function save() {
    const f = state.filter;
    if (!f.name?.trim()) {
      notify.error("El nombre es obligatorio");
      return;
    }
    startTransition(async () => {
      const r = await upsertProductFilterAction({
        id: f.id,
        name: f.name!,
        internal_reference: f.internal_reference ?? null,
        manufacturer_name: f.manufacturer_name ?? null,
        manufacturer_model: f.manufacturer_model ?? null,
        filter_type: (f.filter_type as FilterType) ?? "other",
        micron_rating: f.micron_rating ?? null,
        size_inches: f.size_inches ?? null,
        connection_inches: f.connection_inches ?? null,
        capacity_liters: f.capacity_liters ?? null,
        lifespan_months: f.lifespan_months ?? null,
        sale_price_cents: f.sale_price_cents ?? null,
        stock_managed: f.stock_managed ?? true,
        stock_min: f.stock_min ?? 0,
        stock_max: f.stock_max ?? null,
        supplier_lead_time_days: f.supplier_lead_time_days ?? null,
        main_image_url: f.main_image_url ?? null,
        is_active: f.is_active ?? true,
        notes: f.notes ?? null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(f.id ? "Filtro actualizado" : "Filtro creado");
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("¿Borrar este filtro? Quedará marcado como inactivo, no se borra del histórico.")) return;
    startTransition(async () => {
      const r = await deleteProductFilterAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Filtro borrado");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Buscar</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre o referencia"
            className="h-10 w-56"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FilterType | "")}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {FILTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {FILTER_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto">
          {canEdit && (
            <Button onClick={openCreate}>+ Nuevo filtro</Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Filtro</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Micras</th>
              <th className="px-4 py-3 text-left">Tamaño</th>
              <th className="px-4 py-3 text-left">Vida útil</th>
              <th className="px-4 py-3 text-right">PVP</th>
              <th className="px-4 py-3 text-left">Stock mín</th>
              <th className="px-4 py-3 text-left">En equipos</th>
              <th className="px-4 py-3 text-left">Estado</th>
              {canEdit && <th className="px-4 py-3 text-right">Acción</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 10 : 9}
                  className="p-8 text-center text-muted-foreground"
                >
                  Sin filtros que coincidan.
                </td>
              </tr>
            ) : (
              visible.map((f) => (
                <tr key={f.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.name}</div>
                    {f.internal_reference && (
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {f.internal_reference}
                      </div>
                    )}
                    {f.manufacturer_name && (
                      <div className="text-[11px] text-muted-foreground">
                        {f.manufacturer_name}
                        {f.manufacturer_model && ` · ${f.manufacturer_model}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {FILTER_TYPE_LABEL[f.filter_type]}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {f.micron_rating != null ? `${f.micron_rating} µm` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{f.size_inches ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {f.lifespan_months != null ? `${f.lifespan_months} meses` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs">
                    {eur(f.sale_price_cents)}
                  </td>
                  <td className="px-4 py-3 text-xs">{f.stock_min}</td>
                  <td className="px-4 py-3 text-xs">
                    {f.assignment_count ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    {f.is_active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(f)}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(f.id)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Borrar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {state.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-bold">
              {state.filter.id ? "Editar filtro" : "Nuevo filtro / recambio"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Nombre *</Label>
                <Input
                  value={state.filter.name ?? ""}
                  onChange={(e) =>
                    setState((s) => ({ ...s, filter: { ...s.filter, name: e.target.value } }))
                  }
                  placeholder="Membrana 75 GPD"
                />
              </div>
              <div className="space-y-1">
                <Label>Referencia interna (SKU)</Label>
                <Input
                  value={state.filter.internal_reference ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, internal_reference: e.target.value },
                    }))
                  }
                  placeholder="MEM-75-001"
                />
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <select
                  value={state.filter.filter_type ?? "other"}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, filter_type: e.target.value as FilterType },
                    }))
                  }
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  {FILTER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FILTER_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Fabricante</Label>
                <Input
                  value={state.filter.manufacturer_name ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, manufacturer_name: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Modelo fabricante</Label>
                <Input
                  value={state.filter.manufacturer_model ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, manufacturer_model: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Micras (µm)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={state.filter.micron_rating ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        micron_rating: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Tamaño (10&quot;, 20&quot;, BB 10&quot;…)</Label>
                <Input
                  value={state.filter.size_inches ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, size_inches: e.target.value },
                    }))
                  }
                  placeholder='10"'
                />
              </div>
              <div className="space-y-1">
                <Label>Conexión</Label>
                <Input
                  value={state.filter.connection_inches ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, connection_inches: e.target.value },
                    }))
                  }
                  placeholder='1/4"'
                />
              </div>
              <div className="space-y-1">
                <Label>Capacidad (litros)</Label>
                <Input
                  type="number"
                  value={state.filter.capacity_liters ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        capacity_liters: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Vida útil (meses)</Label>
                <Input
                  type="number"
                  value={state.filter.lifespan_months ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        lifespan_months: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Precio venta (céntimos)</Label>
                <Input
                  type="number"
                  value={state.filter.sale_price_cents ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        sale_price_cents: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Stock mínimo</Label>
                <Input
                  type="number"
                  value={state.filter.stock_min ?? 0}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, stock_min: Number(e.target.value) },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Stock máximo</Label>
                <Input
                  type="number"
                  value={state.filter.stock_max ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        stock_max: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Plazo proveedor (días)</Label>
                <Input
                  type="number"
                  value={state.filter.supplier_lead_time_days ?? ""}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: {
                        ...s.filter,
                        supplier_lead_time_days:
                          e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notas</Label>
                <textarea
                  value={state.filter.notes ?? ""}
                  onChange={(e) =>
                    setState((s) => ({ ...s, filter: { ...s.filter, notes: e.target.value } }))
                  }
                  className="min-h-[60px] w-full rounded-xl border border-input bg-background p-3 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.filter.is_active ?? true}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, is_active: e.target.checked },
                    }))
                  }
                />
                Activo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.filter.stock_managed ?? true}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      filter: { ...s.filter, stock_managed: e.target.checked },
                    }))
                  }
                />
                Gestionar stock
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
