import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { listVacationBalances } from "@/modules/time-tracking/schedule-actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScheduleEditor } from "@/modules/time-tracking/schedule-editor";
import { VacationsTable } from "@/modules/time-tracking/vacations-table";

export const dynamic = "force-dynamic";

export default async function HorariosPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/configuracion" as never);
  }
  const team = await listTeamMembers();
  const year = new Date().getFullYear();
  const balances = await listVacationBalances(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Configuración · Horarios y vacaciones
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define la jornada laboral semanal y los días de vacaciones de cada usuario.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Horario semanal por usuario</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleEditor users={team.map((t) => ({ id: t.user_id, name: t.full_name }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saldo de vacaciones {year}</CardTitle>
        </CardHeader>
        <CardContent>
          <VacationsTable balances={balances} year={year} />
        </CardContent>
      </Card>
    </div>
  );
}
