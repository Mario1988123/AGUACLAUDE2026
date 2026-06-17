import { listCategories } from "@/modules/products/actions";
import { ProductCreateForm } from "@/modules/products/create-form";
import { CatalogQuickImport } from "@/modules/products/catalog-quick-import";

export default async function NuevoProductoPage() {
  const categories = await listCategories();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nuevo producto</h1>
        <p className="text-sm text-muted-foreground">
          Datos básicos. Atributos, imágenes y planes adicionales se gestionan en la ficha.
        </p>
      </div>
      <CatalogQuickImport />
      <ProductCreateForm categories={categories} />
    </div>
  );
}
