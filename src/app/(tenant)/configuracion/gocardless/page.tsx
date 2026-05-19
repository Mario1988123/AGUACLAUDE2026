import { getGoCardlessSettings } from "@/modules/gocardless/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { GoCardlessSettingsForm } from "@/modules/gocardless/settings-form";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GoCardlessConfigPage() {
  const session = await requireSession();
  const settings = await getGoCardlessSettings();
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  // Detectar si el dominio actual tiene protección de Vercel (preview).
  // Las URLs *-vercom.vercel.app o *-username.vercel.app suelen llevar SSO
  // y devolverían 401 al webhook de GoCardless.
  const isVercelPreview = /\.vercel\.app$/i.test(baseUrl);
  const webhookUrl = `${baseUrl}/api/gocardless/webhook?company_id=${session.company_id ?? "<tu_company_id>"}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">GoCardless · Domiciliación SEPA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configura GoCardless para cobrar a clientes por domiciliación bancaria. El cliente firma un mandato online y a partir de ahí puedes cobrar contra esa cuenta.
          </p>
        </div>
        <BackButton href="/configuracion" />
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
          <code className="block rounded-lg bg-muted px-3 py-2 text-xs break-all">
            {webhookUrl}
          </code>
          {isVercelPreview && (
            <div className="flex gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-bold">Este dominio es una preview de Vercel</p>
                <p className="text-xs">
                  Las URLs <code>*.vercel.app</code> tienen protección de
                  acceso (SSO) y devuelven <strong>401 Authentication Required</strong>
                  a los webhooks de GoCardless. Debes apuntar el webhook a tu
                  dominio de producción (sin protección), por ejemplo{" "}
                  <code>https://crm.tuempresa.com</code>.
                </p>
                <p className="text-xs">
                  Configura la variable de entorno{" "}
                  <code>NEXT_PUBLIC_SITE_URL</code> en Vercel con tu dominio
                  definitivo y vuelve a copiar la URL desde aquí.
                </p>
              </div>
            </div>
          )}
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
