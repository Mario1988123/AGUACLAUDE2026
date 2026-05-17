import Link from "next/link";
import { Eye, BarChart3 } from "lucide-react";
import { listIncidents } from "@/modules/incidents/actions";
import { requireSession } from "@/shared/lib/auth/session";
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  ORIGIN_LABEL,
} from "@/modules/incidents/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { CreateIncidentButton } from "@/modules/incidents/create-button";
import { SlaPill } from "@/modules/incidents/sla-pill";

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
  const [incidents, session] = await Promise.all([
    listIncidents(),
    requireSession(),
  ]);
  const canSeeStats =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Incidencias</h1>
          <p className="mt-1 text-sm text-muted-foreground">{incidents.length} incidencias</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canSeeStats && (
            <Link
              href="/incidencias/cumplimiento"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
            >
              <BarChart3 className="h-4 w-4" /> Cumplimiento SLA
            </Link>
          )}
          <CreateIncidentButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin incidencias.</p>
          ) : (
            <>
            {/* Mobile: cards apiladas */}
            <ul className="space-y-2 md:hidden">
              {incidents.map((i) => (
                <li key={i.id} className="rounded-xl border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/incidencias/${i.id}` as never}
                        className="font-mono text-[11px] text-primary hover:underline"
                      >
                        {i.reference_code ?? `#${i.id.slice(0, 8)}`}
                      </Link>
                      <Link
                        href={`/incidencias/${i.id}` as never}
                        className="block font-medium hover:underline"
                      >
                        {i.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {ORIGIN_LABEL[i.origin] ?? i.origin} ·{" "}
                        {new Date(i.created_at).toLocaleDateString("es-ES")}
                      </div>
                    </div>
                    <SlaPill deadlineAt={i.deadline_at} status={i.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                    <StatusPill
                      label={PRIORITY_LABEL[i.priority] ?? i.priority}
                      tone={PRIORITY_TONE[i.priority] ?? "info"}
                    />
                    <StatusPill
                      label={STATUS_LABEL[i.status] ?? i.status}
                      tone={INCIDENT_TONE[i.status] ?? "info"}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabla */}
            <table className="hidden w-full text-sm md:table">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Ref.</th>
                  <th className="py-2 text-left">Título</th>
                  <th className="py-2 text-left">Origen</th>
                  <th className="py-2 text-left">Prioridad</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">SLA</th>
                  <th className="py-2 text-left">Fecha</th>
                  <th className="py-2 text-right">Acciones</th>
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
                    <td className="py-2">
                      <SlaPill deadlineAt={i.deadline_at} status={i.status} />
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleDateString("es-ES")}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/incidencias/${i.id}` as never}
                        title="Ver incidencia"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
