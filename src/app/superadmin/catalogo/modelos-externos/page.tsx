import { listGlobalExternalModels } from "@/modules/superadmin/catalogo/actions";
import { ModelosExternosGestor } from "@/modules/superadmin/catalogo/modelos-externos-gestor";

export const dynamic = "force-dynamic";

export default async function ModelosExternosPage() {
  const modelos = await listGlobalExternalModels().catch(() => []);
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Modelos externos</h1>
        <p className="text-muted-foreground text-sm">
          Equipos de otras marcas que las empresas pueden referenciar en sus clientes.
        </p>
      </div>
      <ModelosExternosGestor items={modelos} />
    </div>
  );
}
