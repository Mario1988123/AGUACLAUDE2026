"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";
import { ShowInCalculatorToggle } from "@/modules/products/edit-form";
import { ProductBulkToolbar, ProductCheckbox } from "@/modules/products/bulk-toolbar";

export interface ProductListItem {
  id: string;
  name: string;
  kind: keyof typeof KIND_LABEL;
  category_name: string | null;
  internal_reference: string | null;
  cash_price_cents: number | null;
  is_active: boolean;
  show_in_calculator: boolean;
  photo_url?: string | null;
}

interface Props {
  products: ProductListItem[];
  categories: Array<{ id: string; name: string }>;
  viewMode: "list" | "grid";
  /** Solo admin/dir comercial puede hacer bulk. */
  canBulk: boolean;
}

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function ProductsListClient({
  products,
  categories,
  viewMode,
  canBulk,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    setSelectedIds((s) => {
      if (s.size === products.length) return new Set();
      return new Set(products.map((p) => p.id));
    });
  };

  const allSelected = useMemo(
    () => products.length > 0 && selectedIds.size === products.length,
    [products.length, selectedIds.size],
  );

  return (
    <div className="space-y-3">
      {canBulk && selectedIds.size > 0 && (
        <ProductBulkToolbar
          selectedIds={Array.from(selectedIds)}
          onClear={() => setSelectedIds(new Set())}
          categories={categories}
        />
      )}

      {viewMode === "grid" ? (
        products.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Sin productos con esos filtros.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <div
                key={p.id}
                className="group relative flex flex-col rounded-xl border bg-card overflow-hidden hover:border-primary transition-colors"
              >
                {canBulk && (
                  <div className="absolute left-2 top-2 z-10 rounded-md bg-background/90 backdrop-blur-sm">
                    <ProductCheckbox
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </div>
                )}
                <Link
                  href={`/productos/${p.id}` as never}
                  className="flex flex-1 flex-col"
                >
                  <div className="aspect-square w-full bg-muted/30 flex items-center justify-center text-muted-foreground text-xs overflow-hidden">
                    {p.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.photo_url}
                        alt={p.name}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <span>Sin foto</span>
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      {KIND_LABEL[p.kind]}
                    </div>
                    <div className="font-bold truncate">{p.name}</div>
                    {p.category_name && (
                      <div className="text-xs text-muted-foreground truncate">
                        {p.category_name}
                      </div>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="text-base font-extrabold tabular-nums">
                        {formatCents(p.cash_price_cents)}
                      </span>
                      {p.is_active ? (
                        <Badge variant="success" className="text-[10px]">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 md:hidden">
            {products.length === 0 ? (
              <li className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
                Sin productos con esos filtros.
              </li>
            ) : (
              products.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border bg-card p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    {canBulk && (
                      <ProductCheckbox
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/productos/${p.id}` as never}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {KIND_LABEL[p.kind]}
                        {p.category_name && ` · ${p.category_name}`}
                      </div>
                      {p.internal_reference && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          Ref: {p.internal_reference}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold tabular-nums">
                        {formatCents(p.cash_price_cents)}
                      </div>
                      {p.is_active ? (
                        <Badge variant="success" className="mt-1">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="mt-1">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                    <ShowInCalculatorToggle
                      productId={p.id}
                      value={p.show_in_calculator}
                    />
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/productos/${p.id}` as never}
                        title="Ver producto"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/productos/${p.id}?edit=1` as never}
                        title="Editar"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>

          {/* Desktop: tabla */}
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {canBulk && (
                    <th className="px-2 py-3 text-left w-8">
                      <ProductCheckbox
                        checked={allSelected}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Categoría</th>
                  <th className="px-4 py-3 text-left">Ref.</th>
                  <th className="px-4 py-3 text-right">Precio contado</th>
                  <th className="px-4 py-3 text-left">Calculadora</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canBulk ? 9 : 8}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Sin productos con esos filtros.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      {canBulk && (
                        <td className="px-2 py-3">
                          <ProductCheckbox
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link
                          href={`/productos/${p.id}` as never}
                          className="font-medium text-primary hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {KIND_LABEL[p.kind]}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.category_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.internal_reference ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCents(p.cash_price_cents)}
                      </td>
                      <td className="px-4 py-3">
                        <ShowInCalculatorToggle
                          productId={p.id}
                          value={p.show_in_calculator}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {p.is_active ? (
                          <Badge variant="success">Activo</Badge>
                        ) : (
                          <Badge variant="secondary">Inactivo</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link
                            href={`/productos/${p.id}` as never}
                            title="Ver producto"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/productos/${p.id}?edit=1` as never}
                            title="Editar"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
