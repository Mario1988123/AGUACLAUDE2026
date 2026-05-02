import Link from "next/link";
import { notFound } from "next/navigation";
import { getIncident } from "@/modules/incidents/actions";
import { listTeamMembers } from "@/modules/agenda/actions";
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  PRIORITY_LABEL,
  PRIORITY_VARIANT,
  ORIGIN_LABEL,
} from "@/modules/incidents/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Timeline } from "@/modules/events/timeline";
import { IncidentActionsPanel } from "@/modules/incidents/incident-actions-panel";
import { createClient } from "@/shared/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let incident;
  try {
    incident = await getIncident(id);
  } catch {
    notFound();
  }

  const team = await listTeamMembers().catch(() => []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let customerName: string | null = null;
  if (incident.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", incident.customer_id)
      .single();
    if (c) {
      const cc = c as {
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      customerName =
        cc.party_kind === "company"
          ? cc.trade_name || cc.legal_name || "Sin nombre"
          : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "Sin nombre";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">
              Incidencia {incident.reference_code ?? `#${incident.id.slice(0, 8)}`}
            </h1>
            <Badge variant={STATUS_VARIANT[incident.status] ?? "default"}>
              {STATUS_LABEL[incident.status] ?? incident.status}
            </Badge>
            <Badge variant={PRIORITY_VARIANT[incident.priority]}>
              {PRIORITY_LABEL[incident.priority]}
            </Badge>
            <Badge variant="outline">{ORIGIN_LABEL[incident.origin] ?? incident.origin}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {customerName && (
              <>
                Cliente:{" "}
                <Link
                  href={`/clientes/${incident.customer_id}` as never}
                  className="text-primary hover:underline"
                >
                  {customerName}
                </Link>{" "}
                ·{" "}
              </>
            )}
            Creada {new Date(incident.created_at).toLocaleString("es-ES")}
          </p>
        </div>
        <Link href="/incidencias" className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{incident.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {incident.description ? (
                <p className="whitespace-pre-wrap">{incident.description}</p>
              ) : (
                <p className="text-muted-foreground">Sin descripción adicional.</p>
              )}
              {incident.installation_id && (
                <div className="text-xs">
                  Vinculada a instalación:{" "}
                  <Link
                    href={`/instalaciones/${incident.installation_id}` as never}
                    className="text-primary hover:underline"
                  >
                    Ver instalación
                  </Link>
                </div>
              )}
              {incident.maintenance_job_id && (
                <div className="text-xs">
                  Vinculada a mantenimiento:{" "}
                  <Link
                    href={`/mantenimientos/${incident.maintenance_job_id}` as never}
                    className="text-primary hover:underline"
                  >
                    Ver mantenimiento
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {incident.resolution_notes && (
            <Card>
              <CardHeader>
                <CardTitle>Resolución</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="whitespace-pre-wrap">{incident.resolution_notes}</p>
                {incident.resolved_at && (
                  <p className="text-xs text-muted-foreground">
                    Resuelta {new Date(incident.resolved_at).toLocaleString("es-ES")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentActionsPanel
              incidentId={incident.id}
              status={incident.status}
              assignedUserId={incident.assigned_user_id}
              team={team}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="incident" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
