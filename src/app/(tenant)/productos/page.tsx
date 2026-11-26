import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { BackButton } from "@/shared/components/back-button";
import { cn } from "@/shared/lib/utils";
import { requireSession } from "@/shared/lib/auth/session";
import { listCategories } from "@/modules/products/actions";
import { KIND_LABEL } from "@/modules/products/schemas";
import { ProductSmartAlerts, getProductAlerts } from "@/modules/products/smart-alerts";
import { ProductsListClient } from "@/modules/products/products-list-client";
import { ProductsEmptyState } from "@/modules/products/empty-state";
import { canSeeProductCost, isProductEditor } from "@/modules/products/permissions";
import { listTagsCatalog } from "@/modules/products/tags-actions";
import { listOutdatedProductIds } from "@/modules/products/catalog-update-actions";
import { leerListaEmpresa, type CategoriaEmpresa } from "@/modules/products/productos-lectura";
import {
  esKioscoEmpresa,
  filtrarProductos,
  filtrosEmpresaAParams,
  formatearEuros,
  leerFiltrosEmpresa,
  ordenarPorNombre,
  plegarGamas,
  type ProductoListaEmpresa,
} from "@/modules/products/productos-vista";
import { ProductosFiltros } from "@/modules/products/productos-filtros";
import { BuscadorCatalogo } from "@/modules/superadmin/catalogo/lista-filtros";
import { KioscoCategorias, type CategoriaKiosco } from "@/modules/superadmin/catalogo/kiosco-categorias";
import { FilaProducto, Pildora } from "@/modules/superadmin/catalogo/fila-producto";
import { TarjetaCarpeta, TarjetaRejilla } from "@/modules/superadmin/catalogo/tarjeta-producto";
import type { ItemLista } from "@/modules/superadmin/catalogo/catalogo-lectura";

export const dynamic = "force-dynamic";

/**
 * /productos — la lista de la empresa POR CATEGORÍAS (diseño §E):
 *   - sin filtros: kiosco de categorías (con foto, sin colores propios);
 *   - ?cat=<id>: sus productos, con las gamas plegadas como carpeta;
 *   - ?gama=<id>: la gama abierta, con sus variantes;
 *   - ?q= o cualquier filtro: resultados de todas las categorías;
 *   - ?vista=tabla: la tabla de siempre (selección múltiple, solo editor).
 * Reutiliza el kiosco, la fila y las tarjetas del catálogo maestro.
 */

const BASE = "/productos";
const SIN_CATEGORIA = "sin";

function hrefCon(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const q = sp.toString();
  return q ? `${BASE}?${q}` : BASE;
}

function MenuMas({ canEdit }: { canEdit: boolean }) {
  const item = "flex h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-muted";
  return (
    <details className="relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-1 rounded-xl border bg-card px-4 text-sm font-semibold hover:bg-muted [&::-webkit-details-marker]:hidden">
        Más <ChevronDown className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border bg-popover p-1 shadow-lg">
        <a href="/api/pdf/catalog" target="_blank" rel="noopener noreferrer" className={item}>
          Catálogo PDF
        </a>
        <Link href={"/productos/filtros" as never} className={item}>
          Filtros y recambios
        </Link>
        {canEdit && (
          <>
            <Link href={"/configuracion/productos" as never} className={item}>
              Configuración
            </Link>
            <Link href={`${BASE}?vista=tabla` as never} className={cn(item, "max-lg:hidden")}>
              Seleccionar varios
            </Link>
          </>
        )}
      </div>
    </details>
  );
}

/** Recuadro izquierdo de la fila: el stock (donde el maestro enseña empresas). */
function RecuadroStock({
  unidades,
  gestionado,
  verUnidades,
}: {
  unidades: number;
  gestionado: boolean;
  verUnidades: boolean;
}) {
  const hay = unidades > 0;
  return (
    <span
      className={cn(
        "flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg",
        hay ? "bg-success text-white" : "bg-muted text-muted-foreground",
      )}
      title={hay ? "Hay stock" : gestionado ? "Sin stock" : "Stock no gestionado"}
    >
      {hay && verUnidades ? (
        <span className="text-base font-bold leading-none tabular-nums">{unidades.toLocaleString("es-ES")}</span>
      ) : hay ? (
        <Check className="h-5 w-5" aria-hidden="true" />
      ) : (
        <span className="text-base font-bold leading-none tabular-nums">0</span>
      )}
      <span className="text-[10px] font-semibold leading-none">{hay ? "stock" : gestionado ? "sin stock" : "stock"}</span>
    </span>
  );
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltrosEmpresa(await searchParams);
  const session = await requireSession();
  const canEdit = isProductEditor(session);
  const verCifras = canSeeProductCost(session);
  const canDelete = session.is_superadmin || session.roles.includes("company_admin");

  const [datos, categoriasLegado, alerts, tagsCatalog, outdatedIds] = await Promise.all([
    leerListaEmpresa(),
    listCategories().catch(() => []),
    verCifras ? getProductAlerts().catch(() => null) : Promise.resolve(null),
    listTagsCatalog().catch(() => []),
    canEdit ? listOutdatedProductIds().catch(() => []) : Promise.resolve([] as string[]),
  ]);

  // Sin categorías: se invita a importar el catálogo estándar.
  if (datos.categorias.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          <p className="text-sm text-muted-foreground">Empieza configurando tu catálogo</p>
        </div>
        <ProductsEmptyState canImport={canEdit} />
      </div>
    );
  }

  const desactualizados = new Set(outdatedIds);
  const catPorId = new Map(datos.categorias.map((c) => [c.id, c]));
  // Categoría raíz de cada categoría (las subcategorías cuentan en su raíz).
  const raizDe = (id: string | null): CategoriaEmpresa | null => {
    let c = id ? (catPorId.get(id) ?? null) : null;
    for (let i = 0; c?.padreId && i < 5; i += 1) c = catPorId.get(c.padreId) ?? c;
    return c;
  };
  const precioDe = (p: ProductoListaEmpresa) =>
    p.cash_price_cents != null && p.cash_price_cents > 0 ? formatearEuros(p.cash_price_cents) : null;
  // Stock de la fila: el suyo y, en una cabeza de gama plegada, el de toda la gama.
  const stockDe = (p: ProductoListaEmpresa, plegado: boolean) => {
    let n = datos.stock.get(p.id) ?? 0;
    if (plegado && datos.gamas.has(p.id)) {
      for (const v of datos.productos) if (v.gama_id === p.id) n += datos.stock.get(v.id) ?? 0;
    }
    return n;
  };

  const cabecera = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="min-w-0 text-2xl font-bold">Productos</h1>
      <div className="flex items-center gap-2">
        <MenuMas canEdit={canEdit} />
        {canEdit && (
          <Button asChild className="h-11">
            <Link href={"/productos/nuevo" as never} aria-label="Nuevo producto">
              <Plus className="h-4 w-4" /> <span className="max-sm:sr-only">Nuevo producto</span>
            </Link>
          </Button>
        )}
      </div>
    </div>
  );

  // ---------------------------------------------------------- tabla antigua
  if (filtros.vista === "tabla" && canEdit) {
    const lista = filtrarProductos(datos.productos, filtros, desactualizados);
    return (
      <div className="min-w-0 space-y-4">
        <BackButton href={BASE} label="Categorías" />
        <h1 className="text-2xl font-bold">Seleccionar productos</h1>
        <ProductsListClient
          products={lista.map((p) => ({
            id: p.id,
            name: p.name,
            kind: p.kind as keyof typeof KIND_LABEL,
            category_name: p.category_id ? (catPorId.get(p.category_id)?.nombre ?? null) : null,
            internal_reference: p.internal_reference,
            cash_price_cents: p.cash_price_cents,
            is_active: p.is_active,
            show_in_calculator: !!p.show_in_calculator,
            photo_url: p.main_image_url,
            tags: p.tags ?? [],
            stock_total: datos.stock.get(p.id) ?? 0,
          }))}
          categories={categoriasLegado}
          viewMode="list"
          canBulk={canEdit}
          canEdit={canEdit}
          canDelete={canDelete}
          canSeeStock={verCifras}
          tagColors={Object.fromEntries(tagsCatalog.map((t) => [t.name, t.color_hex]))}
          outdatedIds={outdatedIds}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------ kiosco
  if (esKioscoEmpresa(filtros)) {
    const porRaiz = new Map<string, ProductoListaEmpresa[]>();
    let sinCategoria = 0;
    for (const p of datos.productos) {
      const r = raizDe(p.category_id);
      if (!r) {
        sinCategoria += 1;
        continue;
      }
      if (!porRaiz.has(r.id)) porRaiz.set(r.id, []);
      porRaiz.get(r.id)!.push(p);
    }
    const tarjetas: CategoriaKiosco[] = datos.categorias
      .filter((c) => !c.padreId)
      .map((c) => {
        const ps = porRaiz.get(c.id) ?? [];
        return {
          key: c.id,
          nombre: c.nombre,
          padre: null,
          total: ps.length,
          miniatura: ordenarPorNombre(ps).find((p) => p.main_image_url)?.main_image_url ?? null,
          iconoClave: c.claveGlobal,
        };
      });
    if (sinCategoria > 0) {
      tarjetas.push({ key: SIN_CATEGORIA, nombre: "Sin categoría", padre: null, total: sinCategoria });
    }
    const vacias = datos.categorias.filter((c) => !c.padreId && !porRaiz.has(c.id)).length;
    const sinPrecio = datos.productos.filter((p) => !p.cash_price_cents || p.cash_price_cents <= 0).length;
    const sinFoto = datos.productos.filter((p) => !p.main_image_url).length;

    return (
      <div className="min-w-0 space-y-4">
        {cabecera}
        <BuscadorCatalogo />
        {verCifras && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            <Link href={hrefCon({ vista: "lista" }) as never} className="inline-flex h-11 shrink-0 items-center rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted">
              {datos.productos.length.toLocaleString("es-ES")} productos
            </Link>
            {sinPrecio > 0 && (
              <Link href={hrefCon({ sinprecio: "1" }) as never} className="inline-flex h-11 shrink-0 items-center rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted">
                {sinPrecio} sin precio
              </Link>
            )}
            {sinFoto > 0 && (
              <Link href={hrefCon({ sinfoto: "1" }) as never} className="inline-flex h-11 shrink-0 items-center rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted">
                {sinFoto} sin foto
              </Link>
            )}
          </div>
        )}
        {alerts && <ProductSmartAlerts alerts={alerts} />}
        <KioscoCategorias
          categorias={tarjetas}
          totalRecambios={datos.totalFiltros}
          base={BASE}
          neutro
          unidad={["producto", "productos"]}
          recambios={
            datos.totalFiltros > 0
              ? { href: "/productos/filtros", nombre: "Filtros y recambios", total: datos.totalFiltros }
              : null
          }
          pie={
            canEdit && vacias > 0 ? (
              <Link
                href={"/configuracion/productos" as never}
                className="inline-flex h-11 items-center text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline"
              >
                {vacias === 1 ? "1 categoría vacía" : `${vacias} categorías vacías`} · Gestionar
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  // --------------------------------------------------- categoría / búsqueda
  const filtrados = filtrarProductos(datos.productos, filtros, desactualizados);
  const catSel = filtros.cat && filtros.cat !== SIN_CATEGORIA ? (catPorId.get(filtros.cat) ?? null) : null;
  const gamaSel = filtros.gama ? (datos.productos.find((p) => p.id === filtros.gama) ?? null) : null;
  let items: ProductoListaEmpresa[];
  let plegado = false;
  if (gamaSel) {
    items = filtrados.filter((p) => p.id === gamaSel.id || p.gama_id === gamaSel.id);
    // La cabeza primero, luego las variantes por nombre.
    items = [
      ...items.filter((p) => p.id === gamaSel.id),
      ...ordenarPorNombre(items.filter((p) => p.id !== gamaSel.id)),
    ];
  } else if (filtros.cat) {
    const enCat = filtrados.filter((p) =>
      filtros.cat === SIN_CATEGORIA ? !raizDe(p.category_id) : raizDe(p.category_id)?.id === filtros.cat,
    );
    items = ordenarPorNombre(plegarGamas(enCat));
    plegado = true;
  } else {
    // Búsqueda o filtro sin categoría: lista plana de todas las categorías.
    items = ordenarPorNombre(filtrados);
  }
  const nModelos = items.length;
  const nProductos = plegado
    ? items.reduce((s, p) => s + (datos.gamas.get(p.id) ?? 1), 0)
    : items.length;

  const titulo = gamaSel
    ? gamaSel.name
    : filtros.cat === SIN_CATEGORIA
      ? "Sin categoría"
      : (catSel?.nombre ?? (filtros.q ? `Resultados de «${filtros.q}»` : "Todos los productos"));
  const params = filtrosEmpresaAParams(filtros);
  const volver = gamaSel
    ? {
        href: hrefCon({ ...params, gama: undefined, cat: filtros.cat || raizDe(gamaSel.category_id)?.id }),
        label: catSel?.nombre ?? raizDe(gamaSel.category_id)?.nombre ?? "Volver",
      }
    : { href: BASE, label: "Categorías" };

  const nombreCat = (p: ProductoListaEmpresa) => (p.category_id ? (catPorId.get(p.category_id)?.nombre ?? null) : null);
  const refDe = (p: ProductoListaEmpresa) => p.internal_reference?.trim() || p.supplier_reference?.trim() || "";
  const esCarpeta = (p: ProductoListaEmpresa) => plegado && datos.gamas.has(p.id);
  const hrefDe = (p: ProductoListaEmpresa) =>
    esCarpeta(p) ? hrefCon({ ...params, gama: p.id }) : `/productos/${p.id}`;

  /** Base común de ItemLista (los campos del maestro van a cero). */
  const base = (p: ProductoListaEmpresa): ItemLista => ({
    id: p.id,
    nombre: p.name,
    modelo: null,
    rasgos: gamaSel ? p.rasgos_identificacion : null,
    ref: refDe(p),
    kind: p.kind,
    // La categoría solo se enseña cuando la lista mezcla categorías.
    categoria: filtros.cat || gamaSel ? null : nombreCat(p),
    fabricante: null,
    familia: null,
    gamaNombre: p.name,
    categoriaKey: null,
    categoriaRaiz: null,
    esVariante: !!p.gama_id && p.gama_id !== p.id && (!!gamaSel || !plegado),
    variantes: esCarpeta(p) ? (datos.gamas.get(p.id) ?? 0) : 0,
    empresas: 0,
    fotos: p.main_image_url ? 1 : 0,
    atributos: 1,
    documentos: 0,
    version: 0,
    activo: p.is_active,
    descatalogado: false,
    cambiosSinPublicar: false,
    miniatura: p.main_image_url,
  });
  // En la fila, el nombre va arriba en grande y la referencia debajo.
  const itemFila = (p: ProductoListaEmpresa): ItemLista => {
    const b = base(p);
    const ref = refDe(p);
    return { ...b, ref: p.name, nombre: ref ? `Ref. ${ref}` : (KIND_LABEL[p.kind as keyof typeof KIND_LABEL] ?? "") };
  };
  const insignias = (p: ProductoListaEmpresa) => (
    <>
      {!p.is_active && <Pildora className="bg-muted text-muted-foreground">Inactivo</Pildora>}
      {canEdit && !precioDe(p) && !esCarpeta(p) && (
        <Pildora className="bg-muted text-muted-foreground">Sin precio</Pildora>
      )}
      {canEdit && desactualizados.has(p.id) && (
        <Pildora className="bg-primary/10 text-primary">Actualización disponible</Pildora>
      )}
    </>
  );

  const vista = filtros.vista === "lista" || filtros.vista === "rejilla" ? filtros.vista : "";
  const filas = (
    <ul className="space-y-2">
      {items.map((p) => (
        <li key={p.id}>
          <FilaProducto
            item={itemFila(p)}
            href={hrefDe(p)}
            neutro
            insignias={insignias(p)}
            precio={esCarpeta(p) ? null : precioDe(p)}
            recuadro={
              <RecuadroStock
                unidades={stockDe(p, esCarpeta(p))}
                gestionado={!!p.stock_managed}
                verUnidades={verCifras}
              />
            }
          />
        </li>
      ))}
    </ul>
  );
  const rejilla = (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {items.map((p) => (
        <li key={p.id} className="flex">
          {esCarpeta(p) ? (
            <TarjetaCarpeta item={base(p)} href={hrefDe(p)} />
          ) : (
            <TarjetaRejilla
              item={base(p)}
              href={hrefDe(p)}
              nombreCompleto={!!gamaSel}
              pie={
                precioDe(p) && (
                  <span className="mt-1 text-sm font-semibold tabular-nums">{precioDe(p)}</span>
                )
              }
            />
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <BackButton href={volver.href} label={volver.label} />
          <h1 className="break-words text-2xl font-bold">{titulo}</h1>
          {plegado && nProductos !== nModelos && (
            <p className="text-sm text-muted-foreground">
              {nProductos} productos en {nModelos} {nModelos === 1 ? "modelo" : "modelos"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MenuMas canEdit={canEdit} />
          {canEdit && (
            <Button asChild className="h-11">
              <Link href={"/productos/nuevo" as never}>
                <Plus className="h-4 w-4" /> <span className="max-sm:sr-only">Nuevo producto</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      <ProductosFiltros
        filtros={filtros}
        canEdit={canEdit}
        tags={tagsCatalog.map((t) => t.name)}
        total={nModelos}
        unidad={plegado ? (nModelos === 1 ? "modelo" : "modelos") : nModelos === 1 ? "producto" : "productos"}
      />

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Ningún producto cumple estos filtros.
        </div>
      ) : vista === "lista" ? (
        filas
      ) : vista === "rejilla" ? (
        rejilla
      ) : (
        <>
          <div className="lg:hidden">{filas}</div>
          <div className="hidden lg:block">{rejilla}</div>
        </>
      )}
    </div>
  );
}
