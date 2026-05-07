import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

const SLA_DEFAULTS = [
  { priority: "critical", hours: 2, color: "destructive" as const },
  { priority: "high", hours: 8, color: "warning" as const },
  { priority: "medium", hours: 24, color: "secondary" as const },
  { priority: "low", hours: 72, color: "outline" as const },
];

export default async function ConfigIncidenciasPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Incidencias</h1>
        <p className="text-sm text-muted-foreground">
          SLA por prioridad y reglas de asignación.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLA por prioridad</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Tiempo máximo desde la creación hasta la resolución. Si una
            incidencia supera el SLA, se notifica al director técnico (escalado).
          </p>
          <div className="space-y-2">
            {SLA_DEFAULTS.map((s) => (
              <div
                key={s.priority}
                className="flex items-center justify-between rounded-lg border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={s.color}>{s.priority.toUpperCase()}</Badge>
                  <span className="text-sm capitalize">{s.priority}</span>
                </div>
                <span className="font-bold">{s.hours} horas</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Asignación automática</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Por defecto, la incidencia queda <strong>sin asignar</strong> hasta
          que el director técnico la dispatcha. Próximamente: asignación
          automática round-robin entre técnicos disponibles.
        </CardContent>
      </Card>
    </div>
  );
}
