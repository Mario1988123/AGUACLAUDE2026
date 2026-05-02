import Link from "next/link";
import { listProducts, listCategories } from "@/modules/products/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";

export const dynamic = "force-dynamic";

const KIND_OPTIONS = ["equipment", "accessory", "consumable", "service"] as const;

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; cat?: string; q?: string; active?: string }>;
}) {
  const sp = await searchParams;
  const kind = KIND_OPTIONS.includes(sp.kind as never) ? sp.kind : undefined;
  const categoryId = sp.cat || undefined;
  const activeOnly = sp.active === "1";
  const [products, categories] = await Promise.all([
    listProducts({ kind, category_id: categoryId, q: sp.q, active_only: activeOnly }),
    listCategories().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">{products.length} productos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={"/configuracion/productos" as never}>Configuración</Link>
          </Button>
          <Button asChild>
            <Link href={"/productos/nuevo" as never}>+ Nuevo producto</Link>
          </Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1 flex-1 min-w-48">
          <label className="text-xs uppercase text-muted-foreground">Buscar</label>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Nombre o referencia..."
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Tipo</label>
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs uppercase text-muted-foreground">Categoría</label>
          <select
            name="cat"
            defaultValue={categoryId ?? ""}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end">
          <input
            type="checkbox"
            name="active"
            value="1"
            defaultChecked={activeOnly}
            className="h-4 w-4"
          />
          <span className="text-xs">Solo activos</span>
        </label>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
        {(kind || categoryId || sp.q || activeOnly) && (
          <Link href="/productos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Producto</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Categoría</th>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-right">Precio contado</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  Sin productos con esos filtros.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/productos/${p.id}` as never}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs">{KIND_LABEL[p.kind]}</td>
                  <td className="px-4 py-3 text-xs">{p.category_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {p.internal_reference ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCents(p.cash_price_cents)}
                  </td>
                  <td className="px-4 py-3">
                    {p.is_active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/productos/${p.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
