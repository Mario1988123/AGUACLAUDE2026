import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { requireSession } from "@/shared/lib/auth/session";
import { listAllMaintenancePlansAction } from "@/modules/maintenance-plans/config-actions";
import { MaintenancePlansEditor } from "@/modules/maintenance-plans/plans-editor";

export const dynamic = "force-dynamic";

export default async function ConfigMantenimientosPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  if (!isAdmin) redirect("/configuracion");

  const plans = await listAllMaintenancePlansAction().catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Planes de mantenimiento</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona los 3 planes (Lite / Medium / Premium) que el comercial
          puede ofrecer al cliente. Los snapshots de los contratos firmados
          NO se ven afectados al editar — son inmutables.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Catálogo</CardTitle>
        </CardHeader>
        <CardContent>
          <MaintenancePlansEditor plans={plans} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cómo funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            · Al completar una instalación, si el contrato principal NO incluye
            mantenimiento, el técnico ve un CTA «Generar contrato de
            mantenimiento» y puede ofrecer al cliente uno de estos 3 planes.
          </p>
          <p>
            · Cada contrato de mantenimiento genera una factura mensual con
            remesa contra el IBAN principal del cliente. El admin lanza la
            remesa desde /mantenimientos.
          </p>
          <p>
            · Si desactivas un plan, deja de ofrecerse a clientes nuevos pero
            los contratos existentes con ese plan siguen vigentes.
          </p>
          <p>
            · Las visitas y descuentos se aplican sobre el catálogo de
            mantenimientos: cuando un técnico cierra una visita marca si está
            cubierta por el plan o se cobra aparte.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
