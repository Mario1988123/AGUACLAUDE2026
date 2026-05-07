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
// Eliminados InstallationWorkReport / PhotoUploadPanel / SignaturesSection
// — todo se gestiona ahora desde InstallationWizard (un único flujo).
import { Timeline } from "@/modules/events/timeline";
import { ReassignInstallationButton } from "@/modules/installations/reassign-button";
import { InstallationWizard } from "@/modules/installations/installation-wizard";
import { listInstallationPhotosFull, listInstallationSignaturesFull } from "@/modules/installations/client-actions";
import { listMaintenancePlans } from "@/modules/maintenance-plans/actions";
import { requireSession } from "@/shared/lib/auth/session";
import { listTeamMembers } from "@/modules/agenda/actions";
import { createClient } from "@/shared/lib/supabase/server";

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
  } catch (e) {
    console.error("[install/page] getInstallation failed:", e);
    notFound();
  }
  const i = inst as unknown as {
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

  const [items, photos, signatures, session, team, photosFull, signaturesFull] =
    await Promise.all([
      getInstallationItems(id).catch(() => []),
      getInstallationPhotos(id).catch(() => []),
      getInstallationSignatures(id).catch(() => []),
      requireSession(),
      listTeamMembers().catch(() => []),
      listInstallationPhotosFull(id).catch(() => []),
      listInstallationSignaturesFull(id).catch(() => []),
    ]);
  // Reasignar instalación restringido a admin de empresa (decisión usuario).
  const canReassign =
    session.is_superadmin || session.roles.includes("company_admin");

  // Cargar cobros del contrato asociado para el wizard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any;
  let payments: Array<{
    id: string;
    concept: string;
    amount_cents: number;
    method: string;
    moment: string;
    status: string;
  }> = [];
  let customerName = "Cliente";
  let customerTaxId: string | null = null;
  let customerId: string | null = null;
  let contractIncludesMaintenance = false;
  if (i.contract_id) {
    try {
      const { data: ps } = await sb
        .from("contract_payments")
        .select("id, concept, amount_cents, method, moment, status")
        .eq("contract_id", i.contract_id)
        .order("display_order");
      payments = (ps ?? []) as typeof payments;
    } catch (e) {
      console.error("[install/page] contract_payments load failed:", e);
    }
    try {
      const { data: ct } = await sb
        .from("contracts")
        .select("customer_id, customer_snapshot, maintenance_included")
        .eq("id", i.contract_id)
        .single();
      if (ct) {
        const ctRow = ct as {
          customer_id: string | null;
          customer_snapshot: Record<string, unknown> | null;
          maintenance_included: boolean | null;
        };
        customerId = ctRow.customer_id;
        contractIncludesMaintenance = Boolean(ctRow.maintenance_included);
        const cust = ctRow.customer_snapshot;
        if (cust) {
          const c = cust as {
            legal_name?: string | null;
            trade_name?: string | null;
            first_name?: string | null;
            last_name?: string | null;
            tax_id?: string | null;
          };
          customerName =
            c.trade_name ||
            c.legal_name ||
            `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
            "Cliente";
          customerTaxId = c.tax_id ?? null;
        }
      }
    } catch (e) {
      console.error("[install/page] contracts load failed:", e);
    }
  }

  // Carga de planes de mantenimiento — si maintenance_plans no está
  // migrado, el wizard simplemente no muestra el CTA al final.
  let maintenancePlans: Awaited<ReturnType<typeof listMaintenancePlans>> = [];
  try {
    maintenancePlans = await listMaintenancePlans();
  } catch (e) {
    console.error("[install/page] listMaintenancePlans failed:", e);
  }

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
        <div className="flex items-center gap-3 flex-wrap">
          {i.status !== "completed" && i.status !== "cancelled" && (
            <InstallationWizard
              installationId={i.id}
              status={i.status}
              startedAt={i.started_at}
              hasPreviousDamage={i.has_previous_damage ?? false}
              needsCountertopDrilling={i.needs_countertop_drilling ?? false}
              items={items}
              photos={photosFull}
              signatures={signaturesFull}
              payments={payments}
              customerName={customerName}
              customerTaxId={customerTaxId}
              representativeName={session.full_name ?? "Técnico"}
              customerId={customerId}
              contractId={i.contract_id}
              maintenancePlans={maintenancePlans}
              contractIncludesMaintenance={contractIncludesMaintenance}
              canEditCollectedPayments={
                session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("commercial_director")
              }
            />
          )}
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

          {/* Fotos y firmas se gestionan desde el wizard de instalación.
              Aquí solo mostramos las que ya existen como vista de solo lectura. */}
          {photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Fotos ({photos.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photosFull.map((p) => (
                    <div
                      key={p.id}
                      className="relative aspect-square overflow-hidden rounded-lg border"
                    >
                      {p.signed_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.signed_url}
                          alt={p.category}
                          className="h-full w-full object-cover"
                        />
                      )}
                      <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                        {p.category}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {signatures.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Firmas ({signatures.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {signatures.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-xl border bg-card p-2"
                    >
                      <div>
                        <div className="font-bold">
                          {s.signer_role === "customer" ? "Cliente" : "Empresa"} ·{" "}
                          {s.signer_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(s.signed_at).toLocaleString("es-ES")}
                          {s.context ? ` · ${s.context}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos del parte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {i.scheduled_at && (
                <div>
                  <strong>Programada:</strong>{" "}
                  {new Date(i.scheduled_at).toLocaleString("es-ES")}
                </div>
              )}
              <div>
                <strong>Daños previos:</strong>{" "}
                {i.has_previous_damage ? "Sí" : "No"}
              </div>
              <div>
                <strong>Agujero encimera:</strong>{" "}
                {i.needs_countertop_drilling ? "Sí" : "No"}
              </div>
              {i.geo_distance_to_address_m != null && (
                <div>
                  <strong>Distancia GPS:</strong>{" "}
                  {Math.round(i.geo_distance_to_address_m)} m
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Para iniciar/continuar el parte usa «Abrir parte de instalación»
                en la cabecera.
              </p>
            </CardContent>
          </Card>
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
