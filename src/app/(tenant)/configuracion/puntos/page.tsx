import { getPointsSettingsAdmin } from "@/modules/points/config-actions";
import { PointsConfigForm } from "@/modules/points/config-form";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPuntosPage() {
  const settings = await getPointsSettingsAdmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración · Programa de puntos</h1>
        <p className="text-sm text-muted-foreground">
          Define cuántos puntos otorgar por cada acción comercial/técnica. Los puntos se acumulan
          automáticamente y se ven en <code>/puntos</code>.
        </p>
      </div>
      <PointsConfigForm initial={settings} />
    </div>
  );
}
