import { getGoCardlessSettings } from "@/modules/gocardless/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { GoCardlessSettingsForm } from "@/modules/gocardless/settings-form";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

export default async function GoCardlessConfigPage() {
  const settings = await getGoCardlessSettings();
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">GoCardless · Domiciliación SEPA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura GoCardless para cobrar a clientes por domiciliación bancaria. El cliente firma un mandato online y a partir de ahí puedes cobrar contra esa cuenta.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Estado
            {settings.configured ? (
              <Badge variant={settings.environment === "live" ? "success" : "secondary"}>
                {settings.environment === "live" ? "Producción" : "Sandbox"}
              </Badge>
            ) : (
              <Badge variant="outline">No configurado</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GoCardlessSettingsForm initial={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configurar webhook en GoCardless</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Para que el CRM se entere automáticamente cuando un mandato se activa o un pago se confirma, debes configurar un webhook en tu panel de GoCardless apuntando aquí:
          </p>
          <code className="block rounded-lg bg-muted px-3 py-2 text-xs">
            {baseUrl}/api/gocardless/webhook?company_id=&lt;tu_company_id&gt;
          </code>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Entra a <a className="text-primary underline" href="https://manage.gocardless.com/developers/webhook-endpoints" target="_blank" rel="noopener">GoCardless → Developers → Webhook endpoints</a>.</li>
            <li>Crea un nuevo endpoint con la URL de arriba.</li>
            <li>Copia el secret generado y pégalo en el formulario superior como Webhook secret.</li>
            <li>Activa los eventos: <code>mandates</code>, <code>payments</code>.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cómo obtener el access token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Para empezar a probar, crea una cuenta sandbox en{" "}
              <a className="text-primary underline" href="https://manage-sandbox.gocardless.com/signup" target="_blank" rel="noopener">manage-sandbox.gocardless.com</a>.
            </li>
            <li>
              Entra a Developers → Create → Access token. Marca scope <code>read_write</code>.
            </li>
            <li>Pega aquí el token y guarda. Selecciona environment <strong>Sandbox</strong>.</li>
            <li>Cuando todo funcione en sandbox, repite con cuenta real en <a className="text-primary underline" href="https://manage.gocardless.com" target="_blank" rel="noopener">manage.gocardless.com</a> y cambia a <strong>Live</strong>.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
