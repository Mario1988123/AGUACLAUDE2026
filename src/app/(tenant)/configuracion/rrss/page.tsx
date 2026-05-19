import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { requireSession } from "@/shared/lib/auth/session";
import { getSocialSettings } from "@/modules/social/settings-actions";
import { SocialSettingsForm } from "@/modules/social/settings-form";

export const dynamic = "force-dynamic";

export default async function SocialConfigPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  const settings = await getSocialSettings();
  if (!settings) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Configuración RRSS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Datos de marca + automatización del calendario editorial. El
            generador usa estos valores para personalizar copys e imágenes.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Marca y automatización</CardTitle>
        </CardHeader>
        <CardContent>
          <SocialSettingsForm initial={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo funciona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            1. <strong>Plantillas atemporales</strong> en código —
            educativas, comerciales, técnicas, locales, efemérides.
          </p>
          <p>
            2. Cada plantilla usa{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {"{{brand_name}}"}
            </code>{" "}
            y{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {"{{brand_hashtag}}"}
            </code>{" "}
            como placeholders — se sustituyen con los valores que pongas
            arriba en cada generación.
          </p>
          <p>
            3. <strong>Catálogo de 30+ efemérides</strong> oficiales (ONU,
            UNESCO, OMS, FAO, PNUMA…) precargado. Cada año se reutilizan
            sin reconfigurar.
          </p>
          <p>
            4. <strong>Generador idempotente</strong> — si re-ejecutas el
            mes, no duplica posts ya creados.
          </p>
          <p>
            5. Con <strong>modo autónomo activado</strong>, el día 25 el
            cron prepara el mes siguiente para que solo tengas que revisar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
