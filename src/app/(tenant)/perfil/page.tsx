import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { getMyEmailSettings } from "@/modules/mailing/actions";
import { EmailSettingsForm } from "@/modules/mailing/email-settings-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await requireSession();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("full_name, phone, job_title, avatar_url")
    .eq("user_id", session.user_id)
    .maybeSingle();

  const emailSettings = await getMyEmailSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">
          Configura tus datos personales y tu email de empresa.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos básicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div>
            <strong>Nombre:</strong> {profile?.full_name ?? "—"}
          </div>
          <div>
            <strong>Email cuenta:</strong> {session.email ?? "—"}
          </div>
          {profile?.job_title && (
            <div>
              <strong>Cargo:</strong> {profile.job_title}
            </div>
          )}
          {profile?.phone && (
            <div>
              <strong>Teléfono:</strong> {profile.phone}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Estos datos los gestiona el admin desde Configuración → Usuarios.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Email empresa para envíos
            {emailSettings?.from_email ? (
              emailSettings.domain_verified ? (
                <Badge variant="success">Verificado</Badge>
              ) : (
                <Badge variant="warning">Dominio sin verificar</Badge>
              )
            ) : (
              <Badge variant="secondary">Sin configurar</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmailSettingsForm
            initial={{
              from_email: emailSettings?.from_email ?? "",
              from_name: emailSettings?.from_name ?? profile?.full_name ?? "",
              signature_html: emailSettings?.signature_html ?? "",
              full_name: profile?.full_name ?? "",
              job_title: profile?.job_title ?? "",
              phone: profile?.phone ?? "",
            }}
            domainVerified={emailSettings?.domain_verified ?? false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
