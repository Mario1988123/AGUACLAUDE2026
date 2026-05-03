import { listCompanyModules } from "@/modules/config/modules/actions";
import { ModulesManager } from "@/modules/config/modules/manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

export default async function ConfiguracionModulosPage() {
  const modules = await listCompanyModules().catch(() => []);
  const active = modules.filter((m) => m.is_active).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Módulos</h1>
        <p className="text-sm text-muted-foreground">
          Activa o desactiva los módulos disponibles para tu empresa. Los módulos esenciales
          (core) no pueden desactivarse. Los aparcados están reservados pero no operativos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {active} de {modules.length} activos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay módulos disponibles o no eres administrador.
            </p>
          ) : (
            <ModulesManager modules={modules} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
