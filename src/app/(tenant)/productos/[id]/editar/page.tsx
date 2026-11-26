import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getProduct, listCategories } from "@/modules/products/actions";
import { ProductEditButton } from "@/modules/products/edit-form";
import { DeleteProductButton } from "@/modules/products/delete-product-button";
import { ProductActiveToggle } from "@/modules/products/product-active-toggle";
import { listPricingPlans } from "@/modules/products/pricing-actions";
import { PricingPlansPanel } from "@/modules/products/pricing-panel";
import { listAttributes } from "@/modules/products/attributes-actions";
import {
  getProductSalesHistory,
  getProductStockSummary,
} from "@/modules/products/stock-actions";
import { ProductStockPanel } from "@/modules/products/stock-panel";
import { BarcodeScanner } from "@/modules/warehouses/barcode-scanner";
import { ProductPhotoUploader } from "@/modules/products/photo-uploader";
import { CollapsibleCard } from "@/modules/products/collapsible-card";
import { PriceHistoryCard } from "@/modules/products/price-history-card";
import { listPriceHistory } from "@/modules/products/bulk-actions";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { canSeeProductCost, isProductEditor } from "@/modules/products/permissions";
import { listProductShares } from "@/modules/products/share-actions";
import { ShareDatasheetPanel } from "@/modules/products/share-panel";
import { getCriticalAttributesState } from "@/modules/products/critical-attrs-actions";
import { CriticalAttributesBanner } from "@/modules/products/critical-attrs-banner";
import { listFilterAssignmentsByProduct } from "@/modules/products/filter-assignments-actions";
import { listProductFilters } from "@/modules/products/filters-actions";
import { ProductFiltersPanel } from "@/modules/products/product-filters-panel";
import { listProductDocuments } from "@/modules/products/documents-actions";
import {
  listProductCertifications,
  listCertificationsCatalog,
} from "@/modules/products/certifications-actions";
import { DocsAndCertsPanel } from "@/modules/products/docs-and-certs-panel";
import { ExtendedFieldsPanel } from "@/modules/products/extended-fields-panel";
import { ExtraTargetsPanel } from "@/modules/products/extra-targets-panel";
import { listExtraTargets, listEquipmentProducts } from "@/modules/products/extra-targets-actions";
import { DatasheetIaguaPanel } from "@/modules/products/datasheet-iagua-panel";
import { getPdfSettings } from "@/modules/config/pdf/actions";
import { listTagsCatalog } from "@/modules/products/tags-actions";
import { getProductCatalogStatus } from "@/modules/products/catalog-update-actions";
import { CatalogUpdateBanner } from "@/modules/products/catalog-update-banner";
import { cargarPanelModeloProducto } from "@/modules/equipos-modelo/datos";
import { PanelModeloProductoCard } from "@/modules/equipos-modelo/panel-modelo-producto";
import { leerCaracteristicasEmpresa } from "@/modules/products/productos-lectura";
import { CaracteristicasEditor } from "@/modules/products/caracteristicas-editor";
import { formatearEuros } from "@/modules/products/productos-vista";

export const dynamic = "force-dynamic";

/**
 * /productos/[id]/editar — los paneles de edición de siempre, movidos tal cual
 * desde la ficha (que ahora es de lectura), en secciones con ancla. Solo el
 * editor de productos. `?seccion=<clave>` abre esa sección al llegar.
 */

const SECCIONES = [
  { clave: "datos", titulo: "Datos" },
  { clave: "fotos", titulo: "Fotos" },
  { clave: "caracteristicas", titulo: "Características" },
  { clave: "ventajas", titulo: "Ventajas y textos de la ficha" },
  { clave: "gama", titulo: "Gama y variantes" },
  { clave: "filtros", titulo: "Filtros y recambios" },
  { clave: "documentos", titulo: "Documentos y certificaciones" },
  { clave: "precio", titulo: "Precio" },
  { clave: "stock", titulo: "Stock y coste" },
  { clave: "compartir", titulo: "Compartir ficha técnica" },
  { clave: "configurador", titulo: "Configurador" },
  { clave: "zona", titulo: "Activar o borrar" },
] as const;
type ClaveSeccion = (typeof SECCIONES)[number]["clave"];

function Seccion({
  clave,
  abierta,
  titulo,
  children,
}: {
  clave: ClaveSeccion;
  abierta: ClaveSeccion;
  titulo?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = titulo ?? SECCIONES.find((s) => s.clave === clave)?.titulo;
  return (
    <section id={clave} className="scroll-mt-20">
      <CollapsibleCard title={t} defaultOpen={abierta === clave}>
        {children}
      </CollapsibleCard>
    </section>
  );
}

export default async function EditarProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ seccion?: string }>;
}) {
  const { id } = await params;
  const seccionRaw = (await searchParams)?.seccion;
  const abierta: ClaveSeccion = SECCIONES.some((s) => s.clave === seccionRaw)
    ? (seccionRaw as ClaveSeccion)
    : "datos";

  const session = await requireSession();
  if (!isProductEditor(session)) redirect(`/productos/${id}` as never);

  let product;
  try {
    product = await getProduct(id);
  } catch {
    notFound();
  }
  const categoryId = (product as { category_id: string | null }).category_id;
  const [
    pricingPlans,
    attributes,
    caract,
    categories,
    stockSummary,
    salesHistory,
    priceHistory,
    shares,
    criticalState,
  ] = await Promise.all([
    listPricingPlans(id),
    listAttributes(categoryId).catch(() => []),
    leerCaracteristicasEmpresa(id),
    listCategories().catch(() => []),
    getProductStockSummary(id).catch(() => ({ total: 0, by_warehouse: [] })),
    getProductSalesHistory(id, 90).catch(() => []),
    listPriceHistory(id).catch(() => []),
    listProductShares(id).catch(() => []),
    getCriticalAttributesState(id).catch(() => ({ isDismissed: true, missing: [] })),
  ]);
  const catalogStatus = await getProductCatalogStatus(id).catch(() => ({
    linked: false,
    hasUpdate: false,
    masterName: null,
    fromVersion: null,
    toVersion: null,
  }));
  const [filterAssignments, availableFilters, documents, productCerts, certCatalog, tagsCatalog] =
    await Promise.all([
      listFilterAssignmentsByProduct(id).catch(() => []),
      listProductFilters({ active_only: true }).catch(() => []),
      listProductDocuments(id).catch(() => []),
      listProductCertifications(id).catch(() => []),
      listCertificationsCatalog().catch(() => []),
      listTagsCatalog().catch(() => []),
    ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = product as any;
  const extendedFieldsInitial = {
    tags: p.tags ?? null,
    marketing_claim: p.marketing_claim ?? null,
    youtube_url: p.youtube_url ?? null,
    qr_target_url: p.qr_target_url ?? null,
    barcode_ean13: p.barcode_ean13 ?? null,
    country_of_origin: p.country_of_origin ?? null,
    manufacturer_name: p.manufacturer_name ?? null,
    manufacturer_model: p.manufacturer_model ?? null,
    warranty_months_general: p.warranty_months_general ?? null,
    warranty_months_electronics: p.warranty_months_electronics ?? null,
    warranty_months_body: p.warranty_months_body ?? null,
    discontinued_at: p.discontinued_at ?? null,
    replaced_by_product_id: p.replaced_by_product_id ?? null,
    installation_diagram_url: p.installation_diagram_url ?? null,
    datasheet_color_accent: p.datasheet_color_accent ?? null,
  };
  const canSeeCost = canSeeProductCost(session);
  const panelModelo = session.company_id
    ? await cargarPanelModeloProducto(session.company_id, product.id).catch(() => null)
    : null;
  // Borrar producto: solo admin de empresa (nivel 1) o superadmin.
  const canDelete = session.is_superadmin || session.roles.includes("company_admin");
  const publicBaseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const pdfSettings = await getPdfSettings().catch(() => null);
  const isIaguaTemplate = pdfSettings?.datasheet_template === "iagua";

  const productRoles = (p.roles ?? []) as string[];
  const isConfiguratorExtra = productRoles.includes("configurator_extra");
  const [extraTargets, equipmentProductsForTargets] = isConfiguratorExtra
    ? await Promise.all([
        listExtraTargets(id).catch(() => ({ categoryIds: [], equipmentProductIds: [] })),
        listEquipmentProducts().catch(() => []),
      ])
    : [
        { categoryIds: [] as string[], equipmentProductIds: [] as string[] },
        [] as Array<{ id: string; name: string; category_id: string | null }>,
      ];

  const usados = new Set(caract.caracteristicas.map((c) => c.atributoId));
  const disponibles = attributes
    .filter((a) => !usados.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, data_type: a.data_type, unit: a.unit }));

  const visibles = SECCIONES.filter(
    (s) =>
      (s.clave !== "ventajas" || isIaguaTemplate) &&
      (s.clave !== "gama" || !!panelModelo) &&
      (s.clave !== "configurador" || isConfiguratorExtra) &&
      (s.clave !== "zona" || canDelete),
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        <BackButton href={`/productos/${product.id}`} label="Ficha" />
        <h1 className="break-words text-2xl font-bold leading-tight">{product.name}</h1>
        <p className="text-sm text-muted-foreground">Editar producto · cada sección guarda lo suyo</p>
      </div>

      <CatalogUpdateBanner productId={product.id} status={catalogStatus} />
      {!criticalState.isDismissed && criticalState.missing.length > 0 && (
        <CriticalAttributesBanner productId={product.id} missing={criticalState.missing} />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
        {/* Menú de secciones: fila deslizable en móvil, columna fija en escritorio */}
        <nav aria-label="Secciones" className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:gap-1 lg:overflow-visible">
            {visibles.map((s) => (
              <li key={s.clave} className="shrink-0">
                <Link
                  href={`/productos/${product.id}/editar?seccion=${s.clave}#${s.clave}` as never}
                  className={
                    "inline-flex h-11 items-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold lg:flex lg:w-full " +
                    (abierta === s.clave
                      ? "bg-primary text-primary-foreground"
                      : "border bg-card hover:bg-muted lg:border-transparent lg:bg-transparent")
                  }
                >
                  {s.titulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-3">
          <Seccion clave="datos" abierta={abierta}>
            <div className="space-y-4">
              <ProductEditButton
                productId={product.id}
                initial={{
                  name: product.name,
                  category_id: categoryId,
                  internal_reference: product.internal_reference ?? null,
                  supplier_reference: product.supplier_reference ?? null,
                  short_description: product.short_description ?? null,
                  long_description: product.long_description ?? null,
                  dim_width_mm: product.dim_width_mm ?? null,
                  dim_height_mm: product.dim_height_mm ?? null,
                  dim_depth_mm: product.dim_depth_mm ?? null,
                  weight_grams: product.weight_grams ?? null,
                  stock_managed: product.stock_managed ?? false,
                  stock_min: product.stock_min ?? 0,
                  // undefined = la columna aún no existe (migración sin aplicar).
                  umbral_furgoneta: (product as { umbral_furgoneta?: number | null }).umbral_furgoneta,
                  show_in_calculator: (product as { show_in_calculator?: boolean }).show_in_calculator ?? false,
                  roles: productRoles,
                }}
                categories={categories}
              />
              <div className="border-t pt-4">
                <h3 className="mb-3 text-sm font-bold">Marca, reclamo, garantías y etiquetas</h3>
                <ExtendedFieldsPanel
                  productId={product.id}
                  initial={extendedFieldsInitial}
                  tagSuggestions={tagsCatalog.map((t) => ({ name: t.name, color_hex: t.color_hex }))}
                  otherProducts={[]}
                />
              </div>
            </div>
          </Seccion>

          <Seccion clave="fotos" abierta={abierta} titulo="Foto principal">
            <ProductPhotoUploader productId={product.id} currentUrl={product.main_image_url ?? null} />
          </Seccion>

          <Seccion
            clave="caracteristicas"
            abierta={abierta}
            titulo={`Características (${caract.caracteristicas.length})`}
          >
            <Link
              href={`/productos/${product.id}/ficha` as never}
              className="mb-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
            >
              Elegir qué sale en el PDF y verlo al momento
            </Link>
            <CaracteristicasEditor
              productId={product.id}
              caracteristicas={caract.caracteristicas}
              disponibles={disponibles}
              hayOrigen={caract.hayOrigen}
            />
          </Seccion>

          {isIaguaTemplate && (
            <Seccion clave="ventajas" abierta={abierta} titulo="Ficha IAGUA: portada y ventajas">
              <DatasheetIaguaPanel
                productId={product.id}
                initial={(p.datasheet_extra as Record<string, unknown> | null) ?? null}
              />
            </Seccion>
          )}

          {panelModelo && (
            <Seccion
              clave="gama"
              abierta={abierta}
              titulo={`Gama y variantes${panelModelo.variantes.length > 0 ? ` · ${panelModelo.variantes.length}` : ""}`}
            >
              <PanelModeloProductoCard datos={panelModelo} canEdit />
            </Seccion>
          )}

          <Seccion clave="filtros" abierta={abierta} titulo={`Filtros y recambios (${filterAssignments.length})`}>
            <ProductFiltersPanel
              productId={product.id}
              productName={product.name}
              initial={filterAssignments}
              availableFilters={availableFilters.map((f) => ({
                id: f.id,
                name: f.name,
                filter_type: f.filter_type,
                lifespan_months: f.lifespan_months,
                internal_reference: f.internal_reference,
              }))}
              canEdit
            />
          </Seccion>

          <Seccion
            clave="documentos"
            abierta={abierta}
            titulo={`Documentos y certificaciones (${documents.length}/${productCerts.length})`}
          >
            <DocsAndCertsPanel
              productId={product.id}
              initialDocuments={documents}
              initialCertifications={productCerts}
              catalog={certCatalog}
              canEdit
            />
          </Seccion>

          <Seccion clave="precio" abierta={abierta} titulo={`Precio · planes (${pricingPlans.length})`}>
            <PricingPlansPanel productId={id} plans={pricingPlans} />
          </Seccion>

          <Seccion clave="stock" abierta={abierta}>
            <div className="space-y-6">
              <ProductStockPanel
                productId={id}
                initial={{
                  stock_managed: product.stock_managed ?? false,
                  stock_min: product.stock_min ?? 0,
                  stock_max: p.stock_max ?? null,
                  lead_time_days: p.lead_time_days ?? null,
                  default_supplier_name: p.default_supplier_name ?? null,
                }}
                summary={stockSummary}
                history={salesHistory}
                canSeeCost={canSeeCost}
              />
              <div className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-bold">Código de barras del fabricante</h3>
                <p className="text-sm">
                  Código actual:{" "}
                  {p.barcode ? (
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{p.barcode}</code>
                  ) : (
                    <span className="text-muted-foreground">sin asociar</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Escanea el código del fabricante una vez y queda memorizado. En las salidas y conteos podrás
                  identificar el producto al instante.
                </p>
                <BarcodeScanner associateToProductId={id} />
              </div>
              {canSeeCost && (
                <div className="space-y-2 border-t pt-4">
                  <h3 className="text-sm font-bold">Coste real (CMP)</h3>
                  <p className="text-sm">
                    Coste medio ponderado:{" "}
                    <span className="font-semibold tabular-nums">
                      {product.cost_cents != null ? formatearEuros(product.cost_cents) : "sin compras aún"}
                    </span>
                  </p>
                  <PriceHistoryCard rows={priceHistory} />
                </div>
              )}
            </div>
          </Seccion>

          <Seccion clave="compartir" abierta={abierta}>
            <ShareDatasheetPanel productId={product.id} initialShares={shares} publicBaseUrl={publicBaseUrl} />
          </Seccion>

          {isConfiguratorExtra && (
            <Seccion clave="configurador" abierta={abierta} titulo="Configurador: dónde se ofrece este extra">
              <ExtraTargetsPanel
                productId={product.id}
                categories={categories}
                equipmentProducts={equipmentProductsForTargets.map((e) => ({ id: e.id, name: e.name }))}
                initialCategoryIds={extraTargets.categoryIds}
                initialEquipmentIds={extraTargets.equipmentProductIds}
              />
            </Seccion>
          )}

          {canDelete && (
            <Seccion clave="zona" abierta={abierta}>
              <div className="flex flex-wrap items-center gap-3">
                <ProductActiveToggle productId={product.id} isActive={product.is_active} />
                {/* Borrar SOLO aparece si el producto está inactivo (regla 2026-06-12). */}
                {!product.is_active ? (
                  <DeleteProductButton productId={product.id} isActive={product.is_active} />
                ) : (
                  <p className="text-sm text-muted-foreground">Para borrarlo, desactívalo antes.</p>
                )}
              </div>
            </Seccion>
          )}
        </div>
      </div>
    </div>
  );
}
