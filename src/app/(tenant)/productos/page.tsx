import Link from "next/link";
import { listProducts, listCategories } from "@/modules/products/actions";
import { Button } from "@/shared/ui/button";
import { KIND_LABEL } from "@/modules/products/schemas";
import {
  ProductSmartAlerts,
  getProductAlerts,
} from "@/modules/products/smart-alerts";
import { ProductsListClient } from "@/modules/products/products-list-client";
import { ProductsEmptyState } from "@/modules/products/empty-state";
import { isProductEditor } from "@/modules/products/permissions";
import { listTagsCatalog } from "@/modules/products/tags-actions";
import { requireSession } from "@/shared/lib/auth/session";

export const dynamic = "force-dynamic";

const KIND_OPTIONS = ["equipment", "accessory", "consumable", "service"] as const;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    cat?: string;
    q?: string;
    active?: string;
    view?: string;
    tag?: string;
  }>;
}) {
  const sp = await searchParams;
  const kind = KIND_OPTIONS.includes(sp.kind as never) ? sp.kind : undefined;
  const categoryId = sp.cat || undefined;
  const activeOnly = sp.active === "1";
  const viewMode: "list" | "grid" = sp.view === "grid" ? "grid" : "list";
  const tagFilter = sp.tag?.trim() || undefined;
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const canEdit = isProductEditor(session);
  // Borrar producto: solo admin de empresa (nivel 1) o superadmin.
  const canDelete =
    session.is_superadmin || session.roles.includes("company_admin");
  const [products, categories, alerts, tagsCatalog] = await Promise.all([
    listProducts({ kind, category_id: categoryId, q: sp.q, active_only: activeOnly }),
    listCategories().catch(() => []),
    isUpper ? getProductAlerts().catch(() => null) : Promise.resolve(null),
    listTagsCatalog().catch(() => []),
  ]);

  const tagColors: Record<string, string> = Object.fromEntries(
    tagsCatalog.map((t) => [t.name, t.color_hex]),
  );

  const filteredProducts = tagFilter
    ? products.filter((p) =>
        Array.isArray(p.tags) ? p.tags.includes(tagFilter) : false,
      )
    : products;

  // Si la empresa todavía no tiene categorías, mostramos el empty state
  // para que el admin importe el catálogo estándar antes de empezar a
  // crear productos. A nivel 2-3 le explicamos que lo debe hacer el admin.
  if (categories.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">
            Empieza configurando tu catálogo
          </p>
        </div>
        <ProductsEmptyState canImport={canEdit} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">
            {tagFilter
              ? `${filteredProducts.length} con tag "${tagFilter}" (de ${products.length})`
              : `${products.length} productos`}
          </p>
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
            <Link href={"/productos/filtros" as never}>🔁 Filtros y recambios</Link>
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" asChild>
                <Link href={"/configuracion/productos" as never}>Configuración</Link>
              </Button>
              <Button asChild>
                <Link href={"/productos/nuevo" as never}>+ Nuevo producto</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {alerts && <ProductSmartAlerts alerts={alerts} />}

      {/* KPIs cabecera productos (decisión 2026-05-20) */}
      {isUpper && (() => {
        const total = products.length;
        const active = products.filter((p) => p.is_active).length;
        const inCalc = products.filter((p) => p.show_in_calculator).length;
        const noPrice = products.filter(
          (p) => !p.cash_price_cents || p.cash_price_cents <= 0,
        ).length;
        return (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Total productos</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{total}</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">Activos</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{active}</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">En calculadora</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums">{inCalc}</div>
            </div>
            <div className={`rounded-xl border p-4 ${noPrice > 0 ? "border-amber-300 bg-amber-50" : "bg-card"}`}>
              <div className="text-xs uppercase text-muted-foreground">Sin precio</div>
              <div className={`mt-1 text-3xl font-extrabold tabular-nums ${noPrice > 0 ? "text-amber-700" : ""}`}>
                {noPrice}
              </div>
            </div>
          </div>
        );
      })()}

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
        {tagsCatalog.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs uppercase text-muted-foreground">Tag</label>
            <select
              name="tag"
              defaultValue={tagFilter ?? ""}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos</option>
              {tagsCatalog.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
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
        {(kind || categoryId || sp.q || activeOnly || tagFilter) && (
          <Link href="/productos" className="text-sm text-muted-foreground hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <ProductsListClient
        products={filteredProducts.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind as keyof typeof KIND_LABEL,
          category_name: p.category_name,
          internal_reference: p.internal_reference,
          cash_price_cents: p.cash_price_cents,
          is_active: p.is_active,
          show_in_calculator: p.show_in_calculator,
          photo_url: (p as { photo_url?: string | null }).photo_url ?? null,
          tags: p.tags,
          stock_total: p.stock_total ?? 0,
        }))}
        categories={categories}
        viewMode={viewMode}
        canBulk={canEdit}
        canEdit={canEdit}
        canDelete={canDelete}
        canSeeStock={isUpper}
        tagColors={tagColors}
      />
    </div>
  );
}
