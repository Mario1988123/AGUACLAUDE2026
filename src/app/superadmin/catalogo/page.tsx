import Link from "next/link";
import { Building2, Package } from "lucide-react";
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={"/superadmin/catalogo/fabricantes" as never}
          className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Building2 className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold">Fabricantes</span>
            <span className="block text-xs text-muted-foreground">
              Fichas de fabricante con logo
            </span>
          </span>
        </Link>
        <Link
          href={"/superadmin/catalogo/productos" as never}
          className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Package className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold">Productos maestros</span>
            <span className="block text-xs text-muted-foreground">
              Productos del fabricante (sin precio/stock) + documentación
            </span>
          </span>
        </Link>
      </div>

      <CatalogoManager
        categories={categories}
        attributes={attributes}
        externalModels={externalModels}
      />
    </div>
  );
}
