import Link from "next/link";
import { notFound } from "next/navigation";
import { getFreeTrial } from "@/modules/free-trials/actions";
import { FreeTrialActionsPanel } from "@/modules/free-trials/actions-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Timeline } from "@/modules/events/timeline";
import { BackButton } from "@/shared/components/back-button";
import { listInstallers } from "@/modules/agenda/actions";
import { createClient } from "@/shared/lib/supabase/server";

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

  // Almacenes + técnicos para el modal de desinstalación, y orden de
  // uninstall pendiente (si ya existe) para no permitir duplicarla.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAdmin = (await createClient()) as any;
  const [whRes, installers, uninstallRes] = await Promise.all([
    sbAdmin
      .from("warehouses")
      .select("id, name, is_used_equipment_default")
      .is("deleted_at", null)
      .order("is_used_equipment_default", { ascending: false }),
    listInstallers().catch(() => []),
    sbAdmin
      .from("installations")
      .select("id, status, reference_code, scheduled_at")
      .eq("free_trial_id", id)
      .eq("kind", "uninstall")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const warehouses = ((whRes.data ?? []) as Array<{
    id: string;
    name: string;
    is_used_equipment_default: boolean | null;
  }>).map((w) => ({
    id: w.id,
    name: w.name,
    is_used_default: !!w.is_used_equipment_default,
  }));
  const pendingUninstall = uninstallRes.data as
    | {
        id: string;
        status: string;
        reference_code: string | null;
        scheduled_at: string | null;
      }
    | null;

  // Cargar nombre + DNI del owner para el modal sign+install
  let ownerName = "Cliente";
  let ownerTaxId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supa = (await (await import("@/shared/lib/supabase/server")).createClient()) as any;
    if (trial.customer_id) {
      const { data } = await supa
        .from("customers")
        .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
        .eq("id", trial.customer_id)
        .maybeSingle();
      if (data) {
        ownerName =
          data.party_kind === "company"
            ? data.trade_name || data.legal_name || "Cliente"
            : `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Cliente";
        ownerTaxId = data.tax_id;
      }
    } else if (trial.lead_id) {
      const { data } = await supa
        .from("leads")
        .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
        .eq("id", trial.lead_id)
        .maybeSingle();
      if (data) {
        ownerName =
          data.party_kind === "company"
            ? data.trade_name || data.legal_name || "Cliente"
            : `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || "Cliente";
        ownerTaxId = data.tax_id;
      }
    }
  } catch {
    /* fail-soft */
  }

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
            {(trial as { is_provisional_install?: boolean })
              .is_provisional_install && (
              <Badge variant="warning">⚙ Instalación provisional</Badge>
            )}
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
            <FreeTrialActionsPanel
              trialId={trial.id}
              status={trial.status}
              isProvisional={
                (trial as { is_provisional_install?: boolean })
                  .is_provisional_install ?? false
              }
              customerName={ownerName}
              customerTaxId={ownerTaxId}
              warehouses={warehouses}
              installers={installers}
              pendingUninstall={pendingUninstall}
            />
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
