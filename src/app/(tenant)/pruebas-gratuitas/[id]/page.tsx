import Link from "next/link";
import { notFound } from "next/navigation";
import { getFreeTrial } from "@/modules/free-trials/actions";
import { FreeTrialActionsPanel } from "@/modules/free-trials/actions-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Timeline } from "@/modules/events/timeline";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Agendada",
  installed: "Instalada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  removed: "Devuelta",
  expired: "Caducada",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "secondary",
  scheduled: "default",
  installed: "warning",
  accepted: "success",
  rejected: "destructive",
  removed: "outline",
  expired: "outline",
};

function fmt(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString("es-ES") : "—";
}

export default async function FreeTrialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let trial;
  try {
    trial = await getFreeTrial(id);
  } catch {
    notFound();
  }

  const ownerLink = trial.customer_id
    ? { href: `/clientes/${trial.customer_id}`, label: "cliente" }
    : trial.lead_id
      ? { href: `/leads/${trial.lead_id}`, label: "lead" }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">
              Prueba gratuita {trial.reference_code ?? `#${trial.id.slice(0, 8)}`}
            </h1>
            <Badge variant={STATUS_VARIANT[trial.status]}>
              {STATUS_LABEL[trial.status] ?? trial.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {trial.duration_days} días de prueba
            {ownerLink && (
              <>
                {" · "}
                <Link
                  href={ownerLink.href as never}
                  className="text-primary hover:underline"
                >
                  Ver {ownerLink.label}
                </Link>
              </>
            )}
          </p>
        </div>
        <BackButton href="/pruebas-gratuitas" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <strong>Programada:</strong> {fmt(trial.scheduled_at)}
              </div>
              <div>
                <strong>Instalada:</strong> {fmt(trial.installed_at)}
              </div>
              <div>
                <strong>Caduca:</strong> {fmt(trial.expires_at)}
              </div>
              {trial.notes && (
                <div>
                  <strong>Notas:</strong> {trial.notes}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equipos en prueba ({trial.items.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {trial.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin items.</p>
              ) : (
                <ul className="divide-y">
                  {trial.items.map((it) => (
                    <li key={it.id} className="flex justify-between py-2 text-sm">
                      <div>
                        <div className="font-medium">{it.product_name_snapshot}</div>
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
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <FreeTrialActionsPanel trialId={trial.id} status={trial.status} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="free_trial" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
