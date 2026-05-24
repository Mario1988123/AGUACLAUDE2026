import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireSession } from "@/shared/lib/auth/session";
import { assertModuleActive } from "@/shared/lib/auth/module-guard";
import { BackButton } from "@/shared/components/back-button";
import { planTeamDayRoutes } from "@/modules/routes/team-actions";
import { TeamRoutesClient } from "@/modules/routes/team-routes-client";

export const dynamic = "force-dynamic";

export default async function RutasEquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await assertModuleActive("routes");
  const session = await requireSession();
  const isLeader =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isLeader) redirect("/rutas");

  const sp = await searchParams;
  const dateIso = sp.date ?? new Date().toISOString().slice(0, 10);
  const team = await planTeamDayRoutes({ date: dateIso });
  const isoDay = dateIso;
  const dateLabel = new Date(`${isoDay}T00:00:00`).toLocaleDateString(
    "es-ES",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
    },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Rutas del equipo</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {dateLabel} · {team.length} miembros
          </p>
        </div>
        <BackButton href="/rutas" />
      </div>

      <TeamRoutesClient initialDate={isoDay} routes={team} />
    </div>
  );
}
