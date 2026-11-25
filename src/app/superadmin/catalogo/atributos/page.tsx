import { leerTaxonomia } from "@/modules/superadmin/catalogo/catalogo-taxonomia";
import { AtributosGestor } from "@/modules/superadmin/catalogo/atributos-gestor";

export const dynamic = "force-dynamic";

export default async function AtributosCatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const { categorias, atributos, error } = await leerTaxonomia();
  return (
    <div className="min-w-0 space-y-4">
      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm">
          No se han podido leer todos los atributos: {error}
        </div>
      )}
      <AtributosGestor
        atributos={atributos}
        categorias={categorias}
        catInicial={uno(sp.cat)}
        qInicial={uno(sp.q)}
      />
    </div>
  );
}
