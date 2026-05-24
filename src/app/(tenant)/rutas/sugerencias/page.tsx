import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { BackButton } from "@/shared/components/back-button";
import { SuggestionsClient } from "@/modules/routes/suggestions-client";

export const dynamic = "force-dynamic";

export default async function RutasSugerenciasPage() {
  await assertModuleActive("routes");
  const session = await requireSession();
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director") ||
    session.roles.includes("sales_rep") ||
    session.roles.includes("telemarketer");
  if (!allowed) redirect("/rutas");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Sugerencias cercanas</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Dame tu ubicación actual y te muestro los leads + clientes
            geolocalizados sin actividad reciente más próximos. Empaca el
            día con visitas eficientes.
          </p>
        </div>
        <BackButton href="/rutas" />
      </div>
      <SuggestionsClient />
    </div>
  );
}
