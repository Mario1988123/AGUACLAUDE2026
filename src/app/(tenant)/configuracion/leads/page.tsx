import { getLeadsConfig } from "@/modules/config/leads/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { LeadsConfigForm } from "@/modules/config/leads/form";

export const dynamic = "force-dynamic";

export default async function ConfiguracionLeadsPage() {
  const config = await getLeadsConfig();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Configuración · Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reglas operativas del módulo Leads.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Caducidad y reasignación</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadsConfigForm initial={config} />
        </CardContent>
      </Card>
    </div>
  );
}
