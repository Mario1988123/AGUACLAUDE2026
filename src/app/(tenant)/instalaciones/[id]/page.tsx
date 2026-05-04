import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getInstallation,
  getInstallationItems,
  getInstallationPhotos,
  getInstallationSignatures,
} from "@/modules/installations/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { STATUS_LABEL, STATUS_VARIANT, KIND_LABEL } from "@/modules/installations/constants";
import { InstallationWorkReport } from "@/modules/installations/work-report";
import { PhotoUploadPanel } from "@/modules/installations/photo-upload";
import { SignaturesSection } from "@/modules/installations/signature-section";
import { Timeline } from "@/modules/events/timeline";
import { ReassignInstallationButton } from "@/modules/installations/reassign-button";
import { requireSession } from "@/shared/lib/auth/session";
import { listTeamMembers } from "@/modules/agenda/actions";

export const dynamic = "force-dynamic";

export default async function InstallationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let inst;
  try {
    inst = await getInstallation(id);
  } catch {
    notFound();
  }
  const i = inst as {
    id: string;
    reference_code: string | null;
    status: string;
    kind: string;
    started_at: string | null;
    completed_at: string | null;
    scheduled_at: string | null;
    has_previous_damage: boolean | null;
    needs_countertop_drilling: boolean | null;
    geo_distance_to_address_m: number | null;
    duration_seconds: number | null;
    notes: string | null;
    contract_id: string | null;
    installer_user_id: string | null;
  };

  const [items, photos, signatures, session, team] = await Promise.all([
    getInstallationItems(id),
    getInstallationPhotos(id),
    getInstallationSignatures(id),
    requireSession(),
    listTeamMembers().catch(() => []),
  ]);
  const canReassign =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">
              Instalación {i.reference_code ?? `#${i.id.slice(0, 8)}`}
            </h1>
            <Badge variant={STATUS_VARIANT[i.status] ?? "default"}>
              {STATUS_LABEL[i.status] ?? i.status}
            </Badge>
            <Badge variant="outline">{KIND_LABEL[i.kind] ?? i.kind}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {i.scheduled_at
              ? `Programada ${new Date(i.scheduled_at).toLocaleString("es-ES")}`
              : "Sin agendar"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/pdf/work-report/${i.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            📄 Parte trabajo PDF
          </a>
          <Link href="/instalaciones" className="text-sm text-primary hover:underline">
            ← Volver
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Equipos a instalar ({items.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin items.</p>
              ) : (
                <ul className="divide-y">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between py-3">
                      <div>
                        <div className="font-medium">{it.product_name}</div>
                        {it.serial_number && (
                          <div className="text-xs text-muted-foreground">
                            S/N: {it.serial_number}
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary">x{it.quantity}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fotos ({photos.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoUploadPanel installationId={i.id} existingPhotos={photos} />
            </CardContent>
          </Card>

          <SignaturesSection installationId={i.id} existingSignatures={signatures} />

          {i.completed_at && (
            <Card>
              <CardHeader>
                <CardTitle>Resumen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <strong>Iniciado:</strong>{" "}
                  {i.started_at && new Date(i.started_at).toLocaleString("es-ES")}
                </div>
                <div>
                  <strong>Completado:</strong>{" "}
                  {new Date(i.completed_at).toLocaleString("es-ES")}
                </div>
                {i.duration_seconds && (
                  <div>
                    <strong>Duración:</strong> {Math.round(i.duration_seconds / 60)} min
                  </div>
                )}
                {i.notes && (
                  <div>
                    <strong>Notas:</strong> {i.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <InstallationWorkReport
            installationId={i.id}
            status={i.status}
            startedAt={i.started_at}
            hasPreviousDamage={i.has_previous_damage}
            needsCountertopDrilling={i.needs_countertop_drilling}
            geoDistanceM={i.geo_distance_to_address_m}
            contractId={i.contract_id}
          />
          {canReassign && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Asignación</CardTitle>
              </CardHeader>
              <CardContent>
                <ReassignInstallationButton
                  installationId={i.id}
                  currentInstallerId={i.installer_user_id}
                  team={team}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="installation" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
