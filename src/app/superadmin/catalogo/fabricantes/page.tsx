import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listManufacturers } from "@/modules/superadmin/catalogo/manufacturers-actions";
import { ManufacturersManager } from "@/modules/superadmin/catalogo/manufacturers-manager";

export const dynamic = "force-dynamic";

export default async function FabricantesPage() {
  const manufacturers = await listManufacturers().catch(() => []);
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={"/superadmin/catalogo" as never}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Catálogo global
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Fabricantes</h1>
        <p className="text-sm text-muted-foreground">
          Fichas de fabricante (con logo). Bajo cada uno cuelgan sus productos maestros.
        </p>
      </div>
      <ManufacturersManager manufacturers={manufacturers} />
    </div>
  );
}
