import Link from "next/link";
import { Eye, User, Zap, FileText, BookOpen, History, Globe } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { BackButton } from "@/shared/components/back-button";
import { getCompanySmtpAction, getMailingDomainStatus } from "@/modules/mailing/actions";
import { CompanySmtpForm } from "@/modules/mailing/company-smtp-form";
import { ProviderGuideTab } from "@/modules/mailing/provider-guide-tab";
import { ListTemplatesTab } from "@/modules/mailing/list-templates-tab";
import { DomainSetupPanel } from "@/modules/mailing/domain-setup-panel";

export const dynamic = "force-dynamic";

export default async function MailingConfigPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }

  const [manual, automated] = await Promise.all([
    getCompanySmtpAction("company_manual").catch(() => null),
    getCompanySmtpAction("company_automated").catch(() => null),
  ]);

  // Proveedor de email de la empresa: si es 'resend', mostramos la pestaña de
  // verificación de dominio. Lo activa el superadmin.
  let isResend = false;
  if (session.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const { data: comp } = await admin
        .from("companies")
        .select("email_provider")
        .eq("id", session.company_id)
        .maybeSingle();
      isResend = comp?.email_provider === "resend";
    } catch {
      isResend = false;
    }
  }
  const domainStatus = isResend ? await getMailingDomainStatus().catch(() => null) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Configuración de mailing</h1>
          <p className="text-sm text-muted-foreground">
            Configura dos cuentas SMTP de empresa:{" "}
            <strong>una personal del admin</strong> (envíos manuales tuyos y
            fallback para usuarios sin SMTP propio) y{" "}
            <strong>una genérica del sistema</strong> (envíos automáticos:
            recordatorios, contratos, citas…).
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Si solo configuras una de las dos, todos los envíos saldrán desde
            esa. El SMTP de cada usuario se configura en{" "}
            <Link href="/configuracion/usuarios" className="text-primary underline">
              /configuracion/usuarios
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/configuracion/mailing/preview"
            className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10"
          >
            <Eye className="h-4 w-4" />
            Preview plantillas
          </Link>
          <Link
            href="/mail"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-bold hover:bg-muted"
          >
            <History className="h-4 w-4" />
            Ver histórico (MAIL)
          </Link>
          <BackButton href="/configuracion" />
        </div>
      </div>

      <Tabs defaultValue="manual">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="manual" className="gap-2">
            <User className="h-4 w-4" />
            Mi SMTP (Admin)
          </TabsTrigger>
          <TabsTrigger value="automated" className="gap-2">
            <Zap className="h-4 w-4" />
            SMTP automático del sistema
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="h-4 w-4" />
            Plantillas
          </TabsTrigger>
          <TabsTrigger value="guide" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Guía proveedores
          </TabsTrigger>
          {isResend && (
            <TabsTrigger value="resend" className="gap-2">
              <Globe className="h-4 w-4" />
              Dominio Resend
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SMTP personal del Admin</CardTitle>
              <p className="text-sm text-muted-foreground">
                Cuenta que usas TÚ cuando envías un email manual desde el CRM
                (propuestas, mensajes a clientes…). También se usa como
                fallback para cualquier usuario que no tenga su propio SMTP
                configurado.
              </p>
            </CardHeader>
            <CardContent>
              <CompanySmtpForm
                scope="company_manual"
                initial={manual ?? undefined}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automated" className="space-y-4">
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-6 text-sm text-blue-900">
              <p>
                <strong>¿Para qué sirve?</strong> Esta cuenta envía los emails
                automáticos del sistema: citas de instalación, contratos
                enviados/firmados, recordatorios de mantenimiento, recordatorios
                de pago, bienvenida a nuevos clientes, asignación de leads, etc.
              </p>
              <p className="mt-2">
                Recomendado: una dirección genérica como{" "}
                <code className="rounded bg-blue-100 px-1">
                  noreply@tuempresa.com
                </code>{" "}
                o{" "}
                <code className="rounded bg-blue-100 px-1">
                  sistema@tuempresa.com
                </code>
                . Si no la configuras, el sistema usa la cuenta del admin
                (pestaña anterior) como fallback.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                SMTP genérico del sistema
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CompanySmtpForm
                scope="company_automated"
                initial={automated ?? undefined}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <ListTemplatesTab />
        </TabsContent>

        <TabsContent value="guide" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Elige tu proveedor de email
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Tarjeta por proveedor con los datos SMTP correctos y los pasos
                específicos. El botón &quot;Usar esta configuración&quot;
                rellena el formulario en las pestañas de SMTP.
              </p>
            </CardHeader>
            <CardContent>
              <ProviderGuideTab />
            </CardContent>
          </Card>
        </TabsContent>

        {isResend && (
          <TabsContent value="resend" className="space-y-4">
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="pt-6 text-sm text-emerald-900">
                Tu empresa envía por <strong>Resend</strong> (activado por el
                administrador de la plataforma). Verifica aquí tu dominio para
                que los emails salgan desde tu dirección y se midan aperturas y
                clics. Mientras el dominio no esté verificado, los envíos caen a
                SMTP.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Verificación de dominio</CardTitle>
              </CardHeader>
              <CardContent>
                <DomainSetupPanel initialDomain={domainStatus} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
