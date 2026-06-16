import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  listGlobalCategoryOptions,
} from "@/modules/superadmin/catalogo/master-products-actions";
import { listManufacturers } from "@/modules/superadmin/catalogo/manufacturers-actions";
import { MasterProductForm } from "@/modules/superadmin/catalogo/master-product-form";

export const dynamic = "force-dynamic";

export default async function NuevoProductoMaestroPage() {
  const [manufacturers, categories] = await Promise.all([
    listManufacturers().catch(() => []),
    listGlobalCategoryOptions().catch(() => []),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={"/superadmin/catalogo/productos" as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Productos maestros
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Nuevo producto maestro</h1>
      </div>
      <MasterProductForm
        mode="create"
        manufacturers={manufacturers.map((m) => ({ id: m.id, name: m.name }))}
        categories={categories}
      />
    </div>
  );
}
