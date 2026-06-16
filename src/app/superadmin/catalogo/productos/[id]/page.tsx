import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  getCatalogProduct,
  listGlobalCategoryOptions,
} from "@/modules/superadmin/catalogo/master-products-actions";
import { listManufacturers } from "@/modules/superadmin/catalogo/manufacturers-actions";
import { MasterProductForm } from "@/modules/superadmin/catalogo/master-product-form";
import { MasterPhotosManager } from "@/modules/superadmin/catalogo/master-photos-manager";
import { MasterDocsManager } from "@/modules/superadmin/catalogo/master-docs-manager";

export const dynamic = "force-dynamic";

export default async function EditarProductoMaestroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, manufacturers, categories] = await Promise.all([
    getCatalogProduct(id).catch(() => null),
    listManufacturers().catch(() => []),
    listGlobalCategoryOptions().catch(() => []),
  ]);
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={"/superadmin/catalogo/productos" as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Productos maestros
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          Ref. proveedor <span className="font-mono">{product.supplier_reference}</span> · versión{" "}
          {product.version}
        </p>
      </div>

      <MasterProductForm
        mode="edit"
        manufacturers={manufacturers.map((m) => ({ id: m.id, name: m.name }))}
        categories={categories}
        product={product}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6">
          <MasterPhotosManager productId={product.id} photos={product.photos} />
        </div>
        <div className="rounded-2xl border bg-card p-6">
          <MasterDocsManager productId={product.id} documents={product.documents} />
        </div>
      </div>
    </div>
  );
}
