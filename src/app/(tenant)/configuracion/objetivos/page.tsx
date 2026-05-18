import Link from "next/link";
import { listObjectives } from "@/modules/sales/actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ObjectivesManager } from "@/modules/sales/objectives-form";
import { BackButton } from "@/shared/components/back-button";
import { BackfillSalesRecordsButton } from "@/modules/sales/backfill-button";

export const dynamic = "force-dynamic";

export default async function ObjectivesConfigPage() {
  const now = new Date();
  const [objectives, team] = await Promise.all([
    listObjectives(now.getFullYear(), now.getMonth() + 1),
    listTeamMembers(),
  ]);
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Configuración · Objetivos mensuales
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define las metas del mes por departamento o por usuario. La
            visualización del cumplimiento (cascada con % completado) está en{" "}
            <Link
              href="/objetivos"
              className="font-bold text-primary hover:underline"
            >
              /objetivos
            </Link>
            .
          </p>
        </div>
        <BackButton href="/configuracion" />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recalcular ventas (emergencia)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            ✅ <strong>Ya no suele hacer falta.</strong> El cron diario
            reconcilia automáticamente cualquier contrato firmado sin
            registros de venta, y el flujo de firma reintenta de inmediato
            si el insert inicial falla.
          </p>
          <p>
            Usa este botón solo si tras cambios manuales en contratos los
            totales del dashboard quedan desfasados. Borra los{" "}
            <code>sales_records</code> previos por contrato y los reinserta
            (idempotente, seguro de repetir).
          </p>
          <BackfillSalesRecordsButton />
        </CardContent>
      </Card>
    </div>
  );
}
