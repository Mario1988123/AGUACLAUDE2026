import Link from "next/link";
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
import { ProductPhotoUploader } from "@/modules/products/photo-uploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { KIND_LABEL } from "@/modules/products/schemas";
import { BackButton } from "@/shared/components/back-button";

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
  const [pricingPlans, attributes, attrValues, categories] = await Promise.all([
    listPricingPlans(id),
    listAttributes((product as { category_id: string | null }).category_id),
    listProductAttributeValues(id),
    listCategories().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{product.name}</h1>
            {product.is_active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="secondary">Inactivo</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{KIND_LABEL[product.kind]}</p>
        </div>
        <div className="flex items-center gap-3">
          <ProductEditButton
            productId={product.id}
            initial={{
              name: product.name,
              category_id: (product as { category_id: string | null }).category_id,
              internal_reference: product.internal_reference ?? null,
              supplier_reference: product.supplier_reference ?? null,
              short_description: product.short_description ?? null,
              long_description: product.long_description ?? null,
              cost_cents: product.cost_cents ?? null,
              supplier_price_cents: product.supplier_price_cents ?? null,
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

      <Card>
        <CardHeader>
          <CardTitle>Foto principal</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductPhotoUploader productId={product.id} currentUrl={product.main_image_url ?? null} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos generales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Costes (admin)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Coste" value={formatCents(product.cost_cents)} />
            <Row label="Precio proveedor" value={formatCents(product.supplier_price_cents)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Gestionado" value={product.stock_managed ? "Sí" : "No"} />
            <Row label="Stock mínimo" value={String(product.stock_min)} />
            <p className="text-xs text-muted-foreground">
              Listado por almacén disponible en el módulo Almacenes.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Planes de precio ({pricingPlans.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <PricingPlansPanel productId={id} plans={pricingPlans} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Atributos ({attrValues.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <AttributesPanel
              productId={id}
              attributes={attributes}
              values={attrValues}
            />
          </CardContent>
        </Card>
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
