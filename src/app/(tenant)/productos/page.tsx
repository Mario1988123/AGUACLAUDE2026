import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { listProducts, listCategories } from "@/modules/products/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";
import { ShowInCalculatorToggle } from "@/modules/products/edit-form";
import {
  ProductSmartAlerts,
  getProductAlerts,
} from "@/modules/products/smart-alerts";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const KIND_OPTIONS = ["equipment", "accessory", "consumable", "service"] as const;

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    cat?: string;
    q?: string;
    active?: string;
    view?: string;
  }>;
}) {
  const sp = await searchParams;
  const kind = KIND_OPTIONS.includes(sp.kind as never) ? sp.kind : undefined;
  const categoryId = sp.cat || undefined;
  const activeOnly = sp.active === "1";
  const viewMode: "list" | "grid" = sp.view === "grid" ? "grid" : "list";
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const [products, categories, alerts] = await Promise.all([
    listProducts({ kind, category_id: categoryId, q: sp.q, active_only: activeOnly }),
    listCategories().catch(() => []),
    isUpper ? getProductAlerts().catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">{products.length} productos</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded-xl border border-input bg-card overflow-hidden">
            <Link
              href={`/productos?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(kind ? { kind } : {}), ...(categoryId ? { cat: categoryId } : {}), ...(activeOnly ? { active: "1" } : {}) }).toString()}` as never}
              className={`px-3 py-2 text-xs font-semibold ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Lista
            </Link>
            <Link
              href={`/productos?${new URLSearchParams({ view: "grid", ...(sp.q ? { q: sp.q } : {}), ...(kind ? { kind } : {}), ...(categoryId ? { cat: categoryId } : {}), ...(activeOnly ? { active: "1" } : {}) }).toString()}` as never}
              className={`px-3 py-2 text-xs font-semibold ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              Grid
            </Link>
          </div>
          <Button variant="outline" asChild>
            <a href="/api/pdf/catalog" target="_blank" rel="noopener noreferrer">
              📄 Catálogo PDF
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href={"/configuracion/productos" as never}>Configuración</Link>
          </Button>
          <Button asChild>
            <Link href={"/productos/nuevo" as never}>+ Nuevo producto</Link>
          </Button>
        </div>
      </div>

      {alerts && <ProductSmartAlerts alerts={alerts} />}

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

      {/* Vista Grid (todas las pantallas) */}
      {viewMode === "grid" ? (
        products.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Sin productos con esos filtros.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => {
              const photoUrl = (p as { photo_url?: string | null }).photo_url;
              return (
                <Link
                  key={p.id}
                  href={`/productos/${p.id}` as never}
                  className="group flex flex-col rounded-xl border bg-card overflow-hidden hover:border-primary transition-colors"
                >
                  <div className="aspect-square w-full bg-muted/30 flex items-center justify-center text-muted-foreground text-xs overflow-hidden">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
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
                        <Badge variant="success" className="text-[10px]">Activo</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )
      ) : (
      <>
      {/* Mobile: cards apiladas */}
      <ul className="space-y-2 md:hidden">
        {products.length === 0 ? (
          <li className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Sin productos con esos filtros.
          </li>
        ) : (
          products.map((p) => (
            <li key={p.id} className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
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
                  <div className="font-bold tabular-nums">{formatCents(p.cash_price_cents)}</div>
                  {p.is_active ? (
                    <Badge variant="success" className="mt-1">Activo</Badge>
                  ) : (
                    <Badge variant="secondary" className="mt-1">Inactivo</Badge>
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

      {/* Desktop: tabla densa */}
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
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
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
