import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { InstallationsConfigForm } from "@/modules/config/installations/form";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigInstalacionesPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cs } = await admin
    .from("company_settings")
    .select("installation_geo_tolerance_m, installation_time_tolerance_min")
    .eq("company_id", session.company_id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Instalaciones</h1>
          <p className="text-sm text-muted-foreground">
            Configuración del proceso de instalación y tolerancias.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tolerancias</CardTitle>
        </CardHeader>
        <CardContent>
          <InstallationsConfigForm
            initial={{
              geo_tolerance_m: cs?.installation_geo_tolerance_m ?? 300,
              time_tolerance_min: cs?.installation_time_tolerance_min ?? 30,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
