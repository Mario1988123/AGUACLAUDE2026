import { leerTaxonomia } from "@/modules/superadmin/catalogo/catalogo-taxonomia";
import { CategoriasGestor } from "@/modules/superadmin/catalogo/categorias-gestor";

export const dynamic = "force-dynamic";

export default async function CategoriasCatalogoPage() {
  const { categorias, error } = await leerTaxonomia();
  return (
    <div className="min-w-0 space-y-4">
      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm">
          No se han podido leer todas las categorías: {error}
        </div>
      )}
      <CategoriasGestor categorias={categorias} />
    </div>
  );
}
