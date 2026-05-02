import { listObjectives } from "@/modules/sales/actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ObjectivesManager } from "@/modules/sales/objectives-form";

export const dynamic = "force-dynamic";

export default async function ObjectivesConfigPage() {
  const now = new Date();
  const [objectives, team] = await Promise.all([
    listObjectives(now.getFullYear(), now.getMonth() + 1),
    listTeamMembers(),
  ]);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Configuración · Objetivos mensuales
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cascada: nivel 1 (admin) define metas por departamento. Nivel 2 (directores) distribuyen
          esas metas entre los nivel 3 a su mando.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Mes actual ({String(now.getMonth() + 1).padStart(2, "0")}/{now.getFullYear()})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ObjectivesManager
            objectives={objectives.map((o) => ({
              ...o,
              metric_kind: o.metric_kind as string,
            }))}
            team={team}
          />
        </CardContent>
      </Card>
    </div>
  );
}
