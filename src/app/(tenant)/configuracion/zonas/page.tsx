import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { BackButton } from "@/shared/components/back-button";
import {
  listServiceZones,
  getSchedulingSettings,
} from "@/modules/scheduling/zones-actions";
import { ZonesManager } from "@/modules/scheduling/zones-manager";

export const dynamic = "force-dynamic";

const ALLOWED = ["company_admin", "technical_director", "commercial_director"];

export default async function ZonasPage() {
  const session = await requireSession();
  const allowed =
    session.is_superadmin || session.roles.some((r) => ALLOWED.includes(r));
  if (!allowed) redirect("/configuracion");

  const [zones, settings] = await Promise.all([
    listServiceZones().catch(() => []),
    getSchedulingSettings().catch(() => ({
      jobs_per_slot: 2,
      offer_weeks: 4,
      radius_km: 15,
    })),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Zonas y rutas</h1>
          <p className="text-sm text-muted-foreground">
            Define las zonas de servicio y los límites de la agenda. El sistema
            los usa para ofrecer al cliente solo fechas viables cuando pide
            cambiar su cita.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <ZonesManager initialZones={zones} initialSettings={settings} />
    </div>
  );
}
