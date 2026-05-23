import { getPointsSettingsAdmin } from "@/modules/points/config-actions";
import { PointsConfigForm } from "@/modules/points/config-form";
import { CommissionsCard } from "@/modules/points/commissions-card";
import { RecomputeSalesPointsButton } from "@/modules/points/recompute-sales-button";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPuntosPage() {
  const settings = await getPointsSettingsAdmin();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Configuración · Programa de puntos</h1>
          <p className="text-sm text-muted-foreground">
            Define cuántos puntos otorgar por cada acción comercial/técnica. Los puntos se acumulan
            automáticamente y se ven en <code>/puntos</code>.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <PointsConfigForm initial={settings} />
      <CommissionsCard />
      <div className="rounded-2xl border border-dashed border-warning/40 bg-warning/5 p-4 space-y-2">
        <h2 className="text-sm font-bold">Recalcular puntos de venta antiguos</h2>
        <p className="text-xs text-muted-foreground">
          Hasta 2026-05-22, los contratos creados directamente por el comercial
          quedaban sin <code>assigned_user_id</code> y no recibían los puntos de
          venta al instalarse. Este botón los recalcula. Es idempotente — no
          duplica puntos.
        </p>
        <RecomputeSalesPointsButton />
      </div>
    </div>
  );
}
