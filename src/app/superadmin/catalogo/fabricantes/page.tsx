import { listManufacturers } from "@/modules/superadmin/catalogo/manufacturers-actions";
import { ManufacturersManager } from "@/modules/superadmin/catalogo/manufacturers-manager";

export const dynamic = "force-dynamic";

export default async function FabricantesPage() {
  const manufacturers = await listManufacturers().catch(() => []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fabricantes</h1>
        <p className="text-sm text-muted-foreground">
          Fichas de fabricante (con logo). Bajo cada uno cuelgan sus productos maestros.
        </p>
      </div>
      <ManufacturersManager manufacturers={manufacturers} />
    </div>
  );
}
