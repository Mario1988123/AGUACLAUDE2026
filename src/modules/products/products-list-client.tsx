"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";
import { ShowInCalculatorToggle } from "@/modules/products/edit-form";
import { ProductBulkToolbar, ProductCheckbox } from "@/modules/products/bulk-toolbar";
import { CatalogModal } from "@/modules/products/catalog-modal";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { deleteProductAction } from "@/modules/products/actions";

/**
 * Botón compacto de BORRAR en la lista (icono papelera). Solo aparece en
 * productos INACTIVOS (regla: solo se borra lo inactivo). Confirma, borra y
 * refresca la lista para que el producto desaparezca sin entrar a la ficha.
 */
function ListDeleteButton({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();
  // Confirmamos FUERA de la transición (así el botón solo sale "cargando"
  // durante el borrado real) y la llamada lleva timeout: nunca se queda colgado.
  async function handle() {
    const ok = await ask({
      message:
        "¿Borrar este producto definitivamente? Solo se puede si no tiene historial (stock, ventas, instalaciones…). Si lo tiene, se queda desactivado.",
      confirmText: "Borrar producto",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const r = await Promise.race([
          deleteProductAction(productId),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 15000),
          ),
        ]);
        if (r.ok) {
          notify.success("Producto borrado");
          router.refresh();
          return;
        }
        if (r.reason === "history") notify.warning("No se puede borrar", r.error);
        else if (r.reason === "active") notify.warning("Primero desactívalo", r.error);
        else notify.error("Error", r.error);
      } catch {
        notify.error(
          "No se pudo completar el borrado",
          "Tardó demasiado o falló la conexión (posible caché del navegador). Recarga con Ctrl+Shift+R y reinténtalo.",
        );
      }
    });
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      title="Borrar producto (inactivo)"
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

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
  tags?: string[];
  /** Stock total sumando todos los almacenes de la empresa. */
  stock_total?: number;
}

interface Props {
  products: ProductListItem[];
  categories: Array<{ id: string; name: string }>;
  viewMode: "list" | "grid";
  /** Solo admin/dir comercial puede hacer bulk. */
  canBulk: boolean;
  /** Mapa tag-name -> color HEX para pintar chips. Default '#4880FF'. */
  tagColors?: Record<string, string>;
  /** Si false (nivel 2 y 3): ocultar lápices de edición y toggle de calculadora. */
  canEdit?: boolean;
  /** Solo admin de empresa / superadmin: muestra el botón Borrar (productos inactivos). */
  canDelete?: boolean;
  /** Solo admin/dir comercial ve la cantidad de stock; el resto "Hay/Sin stock". */
  canSeeStock?: boolean;
}

/** Celda de stock total (suma de almacenes). Cantidad solo para admin/dir comercial. */
function StockCell({ total, canSee }: { total: number; canSee: boolean }) {
  if (!canSee) {
    return total > 0 ? (
      <span className="text-xs font-medium text-emerald-700">Hay stock</span>
    ) : (
      <span className="text-xs font-medium text-destructive">Sin stock</span>
    );
  }
  return (
    <span
      className={`font-semibold tabular-nums ${total > 0 ? "" : "text-destructive"}`}
    >
      {total}
      <span className="ml-1 text-xs font-normal text-muted-foreground">ud</span>
    </span>
  );
}

function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none"
      style={{
        backgroundColor: `${color}1A`,
        borderColor: `${color}55`,
        color,
      }}
    >
      {name}
    </span>
  );
}

function TagsCell({
  tags,
  tagColors,
}: {
  tags?: string[];
  tagColors: Record<string, string>;
}) {
  if (!tags || tags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <TagChip key={t} name={t} color={tagColors[t] ?? "#4880FF"} />
      ))}
    </div>
  );
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
  tagColors = {},
  canEdit = canBulk,
  canDelete = false,
  canSeeStock = false,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [catalogOpen, setCatalogOpen] = useState(false);

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
        <>
          <ProductBulkToolbar
            selectedIds={Array.from(selectedIds)}
            onClear={() => setSelectedIds(new Set())}
            categories={categories}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCatalogOpen(true)}
            >
              📔 Generar catálogo con la selección ({selectedIds.size})
            </Button>
          </div>
          <CatalogModal
            open={catalogOpen}
            onClose={() => setCatalogOpen(false)}
            productIds={Array.from(selectedIds)}
          />
        </>
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
                    {p.tags && p.tags.length > 0 && (
                      <div className="mt-1.5">
                        <TagsCell tags={p.tags} tagColors={tagColors} />
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
                      <div className="mt-1 text-xs text-muted-foreground">
                        Stock:{" "}
                        <StockCell total={p.stock_total ?? 0} canSee={canSeeStock} />
                      </div>
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
                    {canEdit ? (
                      <ShowInCalculatorToggle
                        productId={p.id}
                        value={p.show_in_calculator}
                      />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {p.show_in_calculator ? "En calculadora" : ""}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/productos/${p.id}` as never}
                        title="Ver producto"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      {canEdit && (
                        <Link
                          href={`/productos/${p.id}?edit=1` as never}
                          title="Editar"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                      )}
                      {canDelete && !p.is_active && (
                        <ListDeleteButton productId={p.id} />
                      )}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>

          {/* Desktop: tabla */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
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
                  <th className="px-4 py-3 text-right">Stock</th>
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
                      colSpan={canBulk ? 10 : 9}
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
                      <td className="px-4 py-3 text-right">
                        <StockCell total={p.stock_total ?? 0} canSee={canSeeStock} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.internal_reference ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCents(p.cash_price_cents)}
                      </td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <ShowInCalculatorToggle
                            productId={p.id}
                            value={p.show_in_calculator}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {p.show_in_calculator ? "Sí" : "No"}
                          </span>
                        )}
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
                          {canEdit && (
                            <Link
                              href={`/productos/${p.id}?edit=1` as never}
                              title="Editar"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                          )}
                          {canDelete && !p.is_active && (
                            <ListDeleteButton productId={p.id} />
                          )}
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
