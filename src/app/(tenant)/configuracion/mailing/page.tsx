import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { getMailingDomain } from "@/modules/mailing/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { DomainSetupPanel } from "@/modules/mailing/domain-setup-panel";

export const dynamic = "force-dynamic";

export default async function MailingConfigPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }

  const domain = await getMailingDomain().catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración de mailing</h1>
        <p className="text-sm text-muted-foreground">
          Configura el dominio desde el que tu equipo enviará emails al cliente
          (propuestas, facturas, recordatorios, campañas).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Dominio de envío
            {domain && (
              <Badge
                variant={
                  domain.status === "verified"
                    ? "success"
                    : domain.status === "pending"
                      ? "warning"
                      : "destructive"
                }
              >
                {domain.status === "verified"
                  ? "Verificado"
                  : domain.status === "pending"
                    ? "Pendiente DNS"
                    : "Error"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DomainSetupPanel initialDomain={domain} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Cómo funciona?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>1.</strong> Introduces el dominio de tu empresa (ej.{" "}
            <code>aguasl.com</code>).
          </p>
          <p>
            <strong>2.</strong> Te damos 3 registros DNS (SPF, DKIM, DMARC) que
            tienes que pegar en tu proveedor de dominio (IONOS, Cloudflare,
            GoDaddy...). Es de una sola vez.
          </p>
          <p>
            <strong>3.</strong> Tras verificar, cada usuario configura su email
            empresa en su perfil (ej. <code>maria@aguasl.com</code>) y los
            emails saldrán autenticados a su nombre.
          </p>
          <p className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <strong>Importante:</strong> NO tocamos tu buzón. Tu Google
            Workspace, Microsoft 365 o IONOS sigue funcionando igual para
            recibir emails. Solo somos un emisor autorizado de tu dominio.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
