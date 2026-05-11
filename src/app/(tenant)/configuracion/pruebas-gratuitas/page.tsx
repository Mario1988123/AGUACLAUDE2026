import { getFreeTrialsConfig } from "@/modules/config/free-trials/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { FreeTrialsConfigForm } from "@/modules/config/free-trials/form";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigFreeTrialsPage() {
  const config = await getFreeTrialsConfig();
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Configuración · Pruebas gratuitas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Duración por defecto y condiciones legales que el cliente firma al recibir el equipo en
            prueba.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reglas</CardTitle>
        </CardHeader>
        <CardContent>
          <FreeTrialsConfigForm initial={config} />
        </CardContent>
      </Card>
    </div>
  );
}
