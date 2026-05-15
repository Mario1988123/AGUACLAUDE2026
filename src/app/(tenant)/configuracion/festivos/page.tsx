import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import {
  listHolidaysForYear,
  getCompanyLocality,
} from "@/modules/time-tracking/holidays-actions";
import {
  PROVINCES,
  CCAA_LABELS,
  suggestedHolidaysFor,
} from "@/modules/time-tracking/localities";
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
  const [holidays, locality] = await Promise.all([
    listHolidaysForYear(year),
    getCompanyLocality(),
  ]);
  const recommended = suggestedHolidaysFor(locality.ccaa, locality.city_code);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Configuración · Calendario laboral
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Festivos nacionales precargados. Selecciona tu comunidad y ciudad para que te
            sugiramos los autonómicos y locales. Los pueblos no listados se añaden a mano.
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
            currentCCAA={locality.ccaa}
            currentCity={locality.city_code}
            provinces={PROVINCES}
            ccaaLabels={CCAA_LABELS}
            recommended={recommended}
          />
        </CardContent>
      </Card>
    </div>
  );
}
