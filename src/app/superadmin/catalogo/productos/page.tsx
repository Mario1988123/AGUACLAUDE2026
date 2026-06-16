import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  listCatalogProducts,
} from "@/modules/superadmin/catalogo/master-products-actions";
import { listManufacturers } from "@/modules/superadmin/catalogo/manufacturers-actions";
import { MasterProductsList } from "@/modules/superadmin/catalogo/master-products-list";

export const dynamic = "force-dynamic";

export default async function ProductosMaestrosPage() {
  const [products, manufacturers] = await Promise.all([
    listCatalogProducts().catch(() => []),
    listManufacturers().catch(() => []),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={"/superadmin/catalogo" as never}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Catálogo global
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Productos maestros</h1>
          <p className="text-sm text-muted-foreground">
            Productos del fabricante (sin precio ni stock). Las empresas los obtienen al teclear
            la referencia del proveedor.
          </p>
        </div>
        <Button asChild>
          <Link href={"/superadmin/catalogo/productos/nuevo" as never}>
            <Plus className="h-4 w-4" /> Nuevo producto
          </Link>
        </Button>
      </div>
      <MasterProductsList
        products={products}
        manufacturers={manufacturers.map((m) => ({ id: m.id, name: m.name }))}
      />
    </div>
  );
}
