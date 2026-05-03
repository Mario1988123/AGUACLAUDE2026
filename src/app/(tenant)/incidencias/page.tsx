import Link from "next/link";
import { listIncidents } from "@/modules/incidents/actions";
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  ORIGIN_LABEL,
} from "@/modules/incidents/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { CreateIncidentButton } from "@/modules/incidents/create-button";

const PRIORITY_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  low: "neutral",
  medium: "info",
  high: "onhold",
  critical: "rejected",
};
const INCIDENT_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  open: "onhold",
  assigned: "info",
  in_progress: "processing",
  resolved: "success",
  closed: "neutral",
  cancelled: "neutral",
};

export const dynamic = "force-dynamic";

export default async function IncidenciasPage() {
  const incidents = await listIncidents();
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Incidencias</h1>
          <p className="mt-1 text-sm text-muted-foreground">{incidents.length} incidencias</p>
        </div>
        <CreateIncidentButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin incidencias.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Ref.</th>
                  <th className="py-2 text-left">Título</th>
                  <th className="py-2 text-left">Origen</th>
                  <th className="py-2 text-left">Prioridad</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {incidents.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/50">
                    <td className="py-2 font-mono text-xs">
                      <Link
                        href={`/incidencias/${i.id}` as never}
                        className="text-primary hover:underline"
                      >
                        {i.reference_code ?? `#${i.id.slice(0, 8)}`}
                      </Link>
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/incidencias/${i.id}` as never}
                        className="hover:underline"
                      >
                        {i.title}
                      </Link>
                    </td>
                    <td className="py-2 text-xs">{ORIGIN_LABEL[i.origin] ?? i.origin}</td>
                    <td className="py-2">
                      <StatusPill
                        label={PRIORITY_LABEL[i.priority] ?? i.priority}
                        tone={PRIORITY_TONE[i.priority] ?? "info"}
                      />
                    </td>
                    <td className="py-2">
                      <StatusPill
                        label={STATUS_LABEL[i.status] ?? i.status}
                        tone={INCIDENT_TONE[i.status] ?? "info"}
                      />
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString("es-ES")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
