import { listClauseTemplates } from "@/modules/config/contracts/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ClausesManager } from "@/modules/config/contracts/manager";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfiguracionContratosPage() {
  const clauses = await listClauseTemplates();
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Configuración · Contratos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cláusulas con variables autorellenables que aparecerán en los contratos generados.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cláusulas ({clauses.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ClausesManager clauses={clauses} />
        </CardContent>
      </Card>
    </div>
  );
}
