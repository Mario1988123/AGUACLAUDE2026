import {
  listGlobalCategoriesAdmin,
  listGlobalAttributesAdmin,
  listGlobalExternalModels,
} from "@/modules/superadmin/catalogo/actions";
import { CatalogoManager } from "@/modules/superadmin/catalogo/manager";

export const dynamic = "force-dynamic";

export default async function SuperadminCatalogoPage() {
  const [categories, attributes, externalModels] = await Promise.all([
    listGlobalCategoriesAdmin().catch(() => []),
    listGlobalAttributesAdmin().catch(() => []),
    listGlobalExternalModels().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Catálogo global</h1>
        <p className="text-sm text-muted-foreground">
          Categorías, atributos y modelos externos que las empresas pueden precargar al crear su
          catálogo de productos.
        </p>
      </div>

      <CatalogoManager
        categories={categories}
        attributes={attributes}
        externalModels={externalModels}
      />
    </div>
  );
}
