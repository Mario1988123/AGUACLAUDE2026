import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { listTagsCatalog } from "@/modules/customers/tags-actions";
import { TagsCatalogManager } from "@/modules/customers/tags-catalog-manager";
import { getCustomerRetentionDays } from "@/modules/config/company/actions";
import { CustomerRetentionForm } from "@/modules/config/customers/retention-form";

export const dynamic = "force-dynamic";

export default async function ConfigClientesPage() {
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) {
    redirect("/dashboard");
  }
  // El ajuste de retención es solo para admin (nivel 1).
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  const retentionDays = isAdmin ? await getCustomerRetentionDays().catch(() => 0) : 0;
  const tags = await listTagsCatalog().catch(() => []);
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
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Duración de cliente para el comercial
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cuando un comercial (nivel 3) vende a un cliente, normalmente deja
              de verlo al reasignarse. Aquí defines cuántos días lo sigue viendo
              tras la venta para poder recontactarlo y ofrecerle futuras ventas.
            </p>
            <CustomerRetentionForm initial={retentionDays} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Etiquetas (tags) de cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Etiquetas libres para clasificar clientes (VIP, conflictivo,
            recomendador, etc.). Se asignan desde la ficha del cliente.
          </p>
          <TagsCatalogManager initial={tags} />
        </CardContent>
      </Card>

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
            datos extra puntuales, usa el campo <strong>Notas</strong> de la ficha.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
