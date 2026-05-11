import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { getSlaSettings } from "@/modules/incidents/sla-actions";
import { SlaSettingsForm } from "@/modules/incidents/sla-form";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigIncidenciasPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  const sla = await getSlaSettings();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Incidencias</h1>
          <p className="text-sm text-muted-foreground">
            SLA por prioridad y reglas de asignación.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLA por prioridad</CardTitle>
        </CardHeader>
        <CardContent>
          <SlaSettingsForm initial={sla} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escalado y notificaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>75% del SLA</strong>: el técnico asignado recibe un aviso
            recordatorio.
          </p>
          <p>
            <strong>100% (vencido)</strong>: notificación al director técnico y
            admin de la empresa.
          </p>
          <p>
            <strong>150% del SLA (50% pasado de plazo)</strong>: aviso de
            urgencia adicional al admin.
          </p>
          <p className="pt-2">
            Las incidencias también disparan emails al cliente al asignarse,
            cuando llevan 50% de SLA, y al cerrarse — siempre que el cliente
            tenga concedido el consentimiento RGPD correspondiente.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flujo de asignación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            La incidencia queda <strong>sin asignar</strong> hasta que el
            director técnico la asigna manualmente desde el detalle de la
            incidencia. Esto permite priorizar según carga real del equipo y
            urgencia del caso.
          </p>
          <p>
            El director técnico ve todas las incidencias abiertas de su
            empresa; los técnicos solo ven las suyas y las de su equipo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
