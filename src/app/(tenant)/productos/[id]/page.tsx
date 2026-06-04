import { notFound } from "next/navigation";
import { getProduct, listCategories } from "@/modules/products/actions";
import { ProductEditButton } from "@/modules/products/edit-form";
import { listPricingPlans } from "@/modules/products/pricing-actions";
import { PricingPlansPanel } from "@/modules/products/pricing-panel";
import {
  listAttributes,
  listProductAttributeValues,
} from "@/modules/products/attributes-actions";
import { AttributesPanel } from "@/modules/products/attributes-panel";
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
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { isProductEditor } from "@/modules/products/permissions";
import { listProductShares } from "@/modules/products/share-actions";
import { ShareDatasheetPanel } from "@/modules/products/share-panel";
import { getCriticalAttributesState } from "@/modules/products/critical-attrs-actions";
import { CriticalAttributesBanner } from "@/modules/products/critical-attrs-banner";

export const dynamic = "force-dynamic";

function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let product;
  try {
    product = await getProduct(id);
  } catch {
    notFound();
  }
  const [
    pricingPlans,
    attributes,
    attrValues,
    categories,
    stockSummary,
    salesHistory,
    session,
    priceHistory,
    shares,
    criticalState,
  ] = await Promise.all([
    listPricingPlans(id),
    listAttributes((product as { category_id: string | null }).category_id),
    listProductAttributeValues(id),
    listCategories().catch(() => []),
    getProductStockSummary(id).catch(() => ({ total: 0, by_warehouse: [] })),
    getProductSalesHistory(id, 90).catch(() => []),
    requireSession(),
    listPriceHistory(id).catch(() => []),
    listProductShares(id).catch(() => []),
    getCriticalAttributesState(id).catch(() => ({ isDismissed: true, missing: [] })),
  ]);
  // El coste real es CMP calculado desde las compras y SOLO lo ve el admin
  // (incluido director comercial). Los niveles 3 nunca lo ven.
  const canSeeCost =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  const canEdit = isProductEditor(session);
  const publicBaseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  // Etiqueta de stock al lado del título.
  // - Comerciales (level 3): solo "Hay stock" / "Sin stock", sin cantidad.
  // - Admin / dir comercial: ven la cantidad total.
  const hasStock = stockSummary.total > 0;
  const isLow =
    product.stock_managed &&
    product.stock_min > 0 &&
    stockSummary.total <= product.stock_min;
  const stockBadge = isLow
    ? { variant: "destructive" as const, label: hasStock ? "⚠ Stock bajo" : "Sin stock" }
    : hasStock
      ? { variant: "success" as const, label: "Hay stock" }
      : { variant: "destructive" as const, label: "Sin stock" };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-extrabold tracking-tight">{product.name}</h1>
            {product.is_active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="secondary">Inactivo</Badge>
            )}
            <Badge variant={stockBadge.variant}>{stockBadge.label}</Badge>
            {canSeeCost && hasStock && (
              <span className="text-xs text-muted-foreground tabular-nums">
                ({stockSummary.total} ud)
              </span>
            )}
          </div>
          {product.short_description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {product.short_description}
            </p>
          )}
          <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {KIND_LABEL[product.kind]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canEdit && (
            <ProductEditButton
              productId={product.id}
              initial={{
                name: product.name,
                category_id: (product as { category_id: string | null }).category_id,
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
                show_in_calculator:
                  (product as { show_in_calculator?: boolean }).show_in_calculator ?? false,
              }}
              categories={categories}
            />
          )}
          <a
            href={`/api/pdf/product-datasheet/${product.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 Ficha técnica
          </a>
          <BackButton href="/productos" />
        </div>
      </div>

      {canEdit && !criticalState.isDismissed && criticalState.missing.length > 0 && (
        <CriticalAttributesBanner
          productId={product.id}
          missing={criticalState.missing}
        />
      )}

      {canEdit && (
        <CollapsibleCard title="📤 Compartir ficha técnica" defaultOpen={false}>
          <ShareDatasheetPanel
            productId={product.id}
            initialShares={shares}
            publicBaseUrl={publicBaseUrl}
          />
        </CollapsibleCard>
      )}

      <CollapsibleCard title="Foto principal">
        <ProductPhotoUploader productId={product.id} currentUrl={product.main_image_url ?? null} />
      </CollapsibleCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <CollapsibleCard title="Datos generales">
          <div className="space-y-3 text-sm">
            <Row label="Referencia interna" value={product.internal_reference} />
            <Row label="Referencia proveedor" value={product.supplier_reference} />
            <Row label="Descripción corta" value={product.short_description} />
            <Row
              label="Dimensiones (W×H×D)"
              value={
                product.dim_width_mm && product.dim_height_mm && product.dim_depth_mm
                  ? `${product.dim_width_mm} × ${product.dim_height_mm} × ${product.dim_depth_mm} mm`
                  : null
              }
            />
            <Row label="Peso" value={product.weight_grams ? `${product.weight_grams} g` : null} />
            {product.long_description && (
              <div className="border-t pt-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Descripción larga
                </div>
                <p className="mt-1 whitespace-pre-wrap">{product.long_description}</p>
              </div>
            )}
          </div>
        </CollapsibleCard>

        {canSeeCost && (
          <CollapsibleCard
            title={<span>💰 Coste real (CMP)</span>}
            badge={<Badge variant="secondary">solo admin</Badge>}
          >
            <div className="space-y-3 text-sm">
              <Row label="Coste medio ponderado" value={formatCents(product.cost_cents)} />
            </div>
          </CollapsibleCard>
        )}

        <CollapsibleCard title="Código de barras del fabricante" className="lg:col-span-2">
          <div className="space-y-2">
            <p className="text-sm">
              Código actual:{" "}
              {(product as { barcode?: string | null }).barcode ? (
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {(product as { barcode?: string | null }).barcode}
                </code>
              ) : (
                <span className="text-muted-foreground">— sin asociar —</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Escanea el código del fabricante una vez y queda memorizado.
              En las salidas y conteos podrás identificar el producto al instante.
            </p>
            <BarcodeScanner associateToProductId={id} />
          </div>
        </CollapsibleCard>

        <CollapsibleCard title="Stock y predicción" className="lg:col-span-2">
          <ProductStockPanel
            productId={id}
            initial={{
              stock_managed: product.stock_managed ?? false,
              stock_min: product.stock_min ?? 0,
              stock_max:
                (product as { stock_max?: number | null }).stock_max ?? null,
              lead_time_days:
                (product as { lead_time_days?: number | null }).lead_time_days ?? null,
              default_supplier_name:
                (product as { default_supplier_name?: string | null })
                  .default_supplier_name ?? null,
            }}
            summary={stockSummary}
            history={salesHistory}
            canSeeCost={canSeeCost}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title={`Planes de precio (${pricingPlans.length})`}
          defaultOpen={false}
          className="lg:col-span-2"
        >
          <PricingPlansPanel productId={id} plans={pricingPlans} />
        </CollapsibleCard>

        <CollapsibleCard
          title={`Atributos (${attrValues.length})`}
          defaultOpen={false}
          className="lg:col-span-2"
        >
          <AttributesPanel
            productId={id}
            attributes={attributes}
            values={attrValues}
          />
        </CollapsibleCard>

        {canSeeCost && (
          <div className="lg:col-span-2">
            <PriceHistoryCard rows={priceHistory} />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2">{value || "—"}</div>
    </div>
  );
}
