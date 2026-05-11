import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import {
  listHolidaysForYear,
  getCompanyRegion,
} from "@/modules/time-tracking/holidays-actions";
import { REGION_HOLIDAYS_2026, REGION_LABELS } from "@/modules/time-tracking/regions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { HolidaysManager } from "@/modules/time-tracking/holidays-manager";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function FestivosPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/configuracion" as never);
  }
  const year = new Date().getFullYear();
  const [holidays, region] = await Promise.all([listHolidaysForYear(year), getCompanyRegion()]);
  const recommended = region ? REGION_HOLIDAYS_2026[region] ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Configuración · Calendario laboral
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Festivos nacionales (España) precargados. Selecciona tu provincia para sugerencias y
            añade los festivos locales.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Festivos {year}</CardTitle>
        </CardHeader>
        <CardContent>
          <HolidaysManager
            holidays={holidays}
            currentRegion={region}
            regions={Object.entries(REGION_LABELS).map(([code, name]) => ({ code, name }))}
            recommended={recommended}
          />
        </CardContent>
      </Card>
    </div>
  );
}
