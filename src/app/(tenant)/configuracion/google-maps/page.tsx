import { requireSession } from "@/shared/lib/auth/session";
import { BackButton } from "@/shared/components/back-button";
import { getMyGmapsConfig } from "@/modules/config/google-maps/actions";
import { GoogleMapsDashboard } from "@/modules/config/google-maps/dashboard";
import { getGmapsUsageSummary } from "@/shared/lib/google-maps/config";

export const dynamic = "force-dynamic";

export default async function GoogleMapsPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    return (
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Solo el administrador de la empresa puede ver esta página.
      </div>
    );
  }
  const config = await getMyGmapsConfig();
  const usage = session.company_id
    ? await getGmapsUsageSummary(session.company_id)
    : {
        current_month_usd: 0,
        current_day_usd: 0,
        by_api: [],
        by_user: [],
        history: [],
      };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Google Maps Tools</h1>
          <p className="text-sm text-muted-foreground">
            Configura la integración con Google Maps Platform. Si está
            desactivado, el CRM funciona con OpenStreetMap como hasta ahora.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <GoogleMapsDashboard
        config={config}
        usage={usage}
        has_key={config.has_key}
      />
    </div>
  );
}
