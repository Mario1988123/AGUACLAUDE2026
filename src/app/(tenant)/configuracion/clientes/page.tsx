import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigClientesPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Configuración del módulo de clientes.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reglas de duplicado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            El sistema avisa de posibles duplicados al crear/editar leads y
            clientes mirando: <strong>DNI/CIF</strong> (exacto), <strong>email</strong> (exacto en
            minúsculas), <strong>teléfono principal</strong> (normalizado +34).
          </p>
          <p>
            Los leads ya convertidos NO aparecen como duplicados (decisión
            2026-05-07).
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tipo de cliente y datos clave</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            La ficha de cliente distingue automáticamente entre{" "}
            <strong>particular</strong> (nombre, apellidos, DNI) y{" "}
            <strong>empresa</strong> (razón social, nombre comercial, CIF). El
            módulo gestiona también direcciones múltiples (fiscal, instalación,
            envío) y consentimientos RGPD.
          </p>
          <p>
            Los campos no son configurables por empresa para garantizar
            compatibilidad con facturación, contratos y Verifactu. Si necesitas
            datos extra puntuales, usa el campo <code>notes</code> de la ficha.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
