import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
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
import { UninstallWizard } from "@/modules/installations/uninstall-wizard";
import { PhotoGallery } from "@/modules/installations/photo-gallery";
import { InstallationPrioritySelector } from "@/modules/installations/priority-selector";
import { listInstallationPhotosFull, listInstallationSignaturesFull } from "@/modules/installations/client-actions";
import { listMaintenancePlans } from "@/modules/maintenance-plans/actions";
import { requireSession } from "@/shared/lib/auth/session";
import { BackButton } from "@/shared/components/back-button";
import { SubjectNotificationToast } from "@/modules/notifications/subject-toast";
import { InstallationIncidentRow } from "@/modules/installations/incident-row";
import { listTeamMembers, listInstallers } from "@/modules/agenda/actions";
import { ScheduleInstallationButton } from "@/modules/installations/schedule-button";
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
    address_id: string | null;
  };

  const [items, photos, signatures, session, team, installers, photosFull, signaturesFull] =
    await Promise.all([
      getInstallationItems(id).catch(() => []),
      getInstallationPhotos(id).catch(() => []),
      getInstallationSignatures(id).catch(() => []),
      requireSession(),
      listTeamMembers().catch(() => []),
      listInstallers().catch(() => []),
      listInstallationPhotosFull(id).catch(() => []),
      listInstallationSignaturesFull(id).catch(() => []),
    ]);
  // Scope check: nivel 2/3 solo accede a instalaciones de su scope.
  {
    const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
    const visibleUserIds = await resolveVisibleUserIds(session);
    if (visibleUserIds !== null) {
      const inScope =
        i.installer_user_id != null && visibleUserIds.includes(i.installer_user_id);
      if (!inScope) notFound();
    }
  }
  // Reasignar instalación restringido a admin de empresa (decisión usuario).
  const canReassign =
    session.is_superadmin || session.roles.includes("company_admin");
  // Resolver / reclasificar incidencias: admin + director técnico.
  const canResolveIncidents =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");

  // Cargar cobros del contrato asociado para el wizard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any;

  // Incidencias abiertas asociadas a esta instalación. Se muestran en
  // un banner rojo si las hay (puede tener status normal pero incidencia
  // notificada sin desagendar).
  let openIncidents: Array<{
    id: string;
    kind: string | null;
    description: string | null;
    title: string | null;
    created_at: string;
    source: "installation_incidents" | "incidents";
  }> = [];
  try {
    const { data } = await sb
      .from("installation_incidents")
      .select("id, kind, description, created_at")
      .eq("installation_id", id)
      .is("resolved_at", null)
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as Array<{
      id: string;
      kind: string;
      description: string | null;
      created_at: string;
    }>) {
      openIncidents.push({
        id: r.id,
        kind: r.kind,
        description: r.description,
        title: null,
        created_at: r.created_at,
        source: "installation_incidents",
      });
    }
  } catch {
    /* tabla aún no migrada */
  }
  try {
    const { data } = await sb
      .from("incidents")
      .select("id, title, description, created_at, status")
      .eq("installation_id", id)
      .in("status", ["open", "assigned", "in_progress"])
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      created_at: string;
    }>) {
      openIncidents.push({
        id: r.id,
        kind: null,
        description: r.description,
        title: r.title,
        created_at: r.created_at,
        source: "incidents",
      });
    }
  } catch {
    /* no debería pasar */
  }
  // Ordenar por más recientes primero
  openIncidents = openIncidents.sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

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
  let contractStatus: string | null = null;
  let contractPlanType: "cash" | "rental" | "renting" | null = null;
  let contractMaintenancePeriodicityMonths: number | null = null;
  let contractMaintenanceMonthsIncluded: number | null = null;
  let contractDurationMonths: number | null = null;
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
        .select(
          "customer_id, customer_snapshot, maintenance_included, status, plan_type, maintenance_periodicity_months, maintenance_months_included, duration_months",
        )
        .eq("id", i.contract_id)
        .single();
      if (ct) {
        const ctRow = ct as {
          customer_id: string | null;
          customer_snapshot: Record<string, unknown> | null;
          maintenance_included: boolean | null;
          status: string | null;
          plan_type: "cash" | "rental" | "renting" | null;
          maintenance_periodicity_months: number | null;
          maintenance_months_included: number | null;
          duration_months: number | null;
        };
        customerId = ctRow.customer_id;
        contractIncludesMaintenance = Boolean(ctRow.maintenance_included);
        contractStatus = ctRow.status ?? null;
        contractPlanType = ctRow.plan_type ?? null;
        contractMaintenancePeriodicityMonths = ctRow.maintenance_periodicity_months;
        contractMaintenanceMonthsIncluded = ctRow.maintenance_months_included;
        contractDurationMonths = ctRow.duration_months;
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

  // Datos extra del cliente para mostrar en el wizard: teléfono, email
  // y dirección de instalación. El customer_snapshot del contrato puede
  // no tenerlos completos; preferimos query directa a customers + addresses.
  let customerPhone: string | null = null;
  let customerEmail: string | null = null;
  let installationAddress: string | null = null;
  if (customerId) {
    try {
      const { data: c } = await sb
        .from("customers")
        .select("email, phone_primary")
        .eq("id", customerId)
        .maybeSingle();
      if (c) {
        customerPhone = (c as { phone_primary: string | null }).phone_primary ?? null;
        customerEmail = (c as { email: string | null }).email ?? null;
      }
    } catch (e) {
      console.error("[install/page] customer phone/email load:", e);
    }
  }
  if (i.address_id) {
    try {
      const { data: a } = await sb
        .from("addresses")
        .select(
          "street_type, street, street_number, portal, floor, door, postal_code, city, province",
        )
        .eq("id", i.address_id)
        .maybeSingle();
      if (a) {
        installationAddress =
          [
            `${a.street_type ?? ""} ${a.street ?? ""} ${a.street_number ?? ""}`.trim(),
            a.portal ? `Portal ${a.portal}` : null,
            a.floor ?? null,
            a.door ?? null,
            a.postal_code,
            a.city,
            a.province,
          ]
            .filter(Boolean)
            .join(", ") || null;
      }
    } catch (e) {
      console.error("[install/page] address load:", e);
    }
  }

  // Warehouses para wizard de retirada (solo si kind=uninstall)
  let uninstallWarehouses: Array<{
    id: string;
    name: string;
    is_used_default: boolean;
  }> = [];
  if (i.kind === "uninstall") {
    try {
      const { data: wh } = await sb
        .from("warehouses")
        .select("id, name, is_used_equipment_default")
        .is("deleted_at", null)
        .order("name");
      type WH = { id: string; name: string; is_used_equipment_default: boolean | null };
      uninstallWarehouses = ((wh ?? []) as WH[]).map((w) => ({
        id: w.id,
        name: w.name,
        is_used_default: w.is_used_equipment_default === true,
      }));
    } catch {
      /* */
    }
  }

  return (
    <div className="space-y-6">
      <SubjectNotificationToast subjectType="installation" subjectId={id} />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-extrabold tracking-tight">
              Instalación {i.reference_code ?? `#${i.id.slice(0, 8)}`}
            </h1>
            <Badge variant={STATUS_VARIANT[i.status] ?? "default"}>
              {STATUS_LABEL[i.status] ?? i.status}
            </Badge>
            <Badge variant="outline">{KIND_LABEL[i.kind] ?? i.kind}</Badge>
            <InstallationPrioritySelector
              installationId={i.id}
              current={
                ((i as unknown as { priority?: "low" | "normal" | "high" | "urgent" }).priority) ?? "normal"
              }
              canEdit={
                session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("technical_director")
              }
            />
            {openIncidents.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <AlertTriangle className="h-3 w-3" />
                {openIncidents.length === 1
                  ? "Con incidencia"
                  : `${openIncidents.length} incidencias`}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {i.scheduled_at
              ? `Programada ${new Date(i.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`
              : "Sin agendar"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {i.status !== "completed" && i.status !== "cancelled" && (
            <ScheduleInstallationButton
              installationId={i.id}
              currentScheduledAt={i.scheduled_at}
              currentInstallerId={i.installer_user_id}
              installers={installers}
            />
          )}
          {/* Wizard de RETIRADA dedicado si kind=uninstall (decisión 2026-05-20) */}
          {i.status !== "completed" && i.status !== "cancelled" && i.kind === "uninstall" && (
            <UninstallWizard
              installationId={i.id}
              status={i.status}
              photos={photosFull}
              customerName={customerName}
              scheduledAt={i.scheduled_at}
              warehouses={uninstallWarehouses}
            />
          )}
          {i.status !== "completed" && i.status !== "cancelled" && i.kind !== "uninstall" && (
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
              contractMaintenancePeriodicityMonths={contractMaintenancePeriodicityMonths}
              contractMaintenanceMonthsIncluded={contractMaintenanceMonthsIncluded}
              contractDurationMonths={contractDurationMonths}
              canEditCollectedPayments={
                session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("commercial_director")
              }
              contractStatus={contractStatus ?? undefined}
              contractPlanType={contractPlanType}
              customerPhone={customerPhone}
              customerEmail={customerEmail}
              installationAddress={installationAddress}
              scheduledAt={i.scheduled_at}
              hasOpenIncident={openIncidents.length > 0}
              kind={i.kind === "uninstall" ? "uninstall" : "install"}
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
          <BackButton href="/instalaciones" />
        </div>
      </div>

      {openIncidents.length > 0 && (
        <Card className="border-2 border-red-300 bg-red-50/60">
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2 text-red-900">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <span className="text-sm font-bold uppercase tracking-wider">
                {openIncidents.length === 1
                  ? "Incidencia abierta"
                  : `${openIncidents.length} incidencias abiertas`}
              </span>
            </div>
            <ul className="space-y-1.5">
              {openIncidents.map((inc) => (
                <InstallationIncidentRow
                  key={`${inc.source}:${inc.id}`}
                  id={inc.id}
                  kind={inc.kind}
                  title={inc.title}
                  description={inc.description}
                  createdAt={inc.created_at}
                  source={inc.source}
                  canManage={canResolveIncidents}
                />
              ))}
            </ul>
            <p className="text-[11px] text-red-700">
              Resuelve la incidencia antes de continuar el parte. Si el
              problema bloquea el trabajo, pulsa «Notificar incidencia →
              Parar instalación y reagendar» dentro del parte.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Card destacada del cliente — visible siempre en la cabecera de la
          ficha. Antes solo aparecía dentro del wizard cuando se abría el
          modal y el usuario reportaba que "no veía el bloque con todos los
          datos" en la página de detalle. */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="space-y-3 pt-6">
          <div className="text-xs font-bold uppercase tracking-wider text-primary">
            Cliente
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="text-2xl font-extrabold text-foreground">
              {customerName}
            </div>
            {customerTaxId && (
              <Badge variant="outline" className="text-sm">
                {customerTaxId}
              </Badge>
            )}
            {customerId && (
              <Link
                href={`/clientes/${customerId}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Ver ficha del cliente →
              </Link>
            )}
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {installationAddress && (
              <div>
                <span className="font-semibold text-muted-foreground">
                  Dirección de instalación:
                </span>{" "}
                {installationAddress}
              </div>
            )}
            {customerPhone && (
              <div>
                <span className="font-semibold text-muted-foreground">
                  Teléfono:
                </span>{" "}
                <a
                  href={`tel:${customerPhone}`}
                  className="font-bold text-primary hover:underline"
                >
                  📞 {customerPhone}
                </a>
              </div>
            )}
            {customerEmail && (
              <div>
                <span className="font-semibold text-muted-foreground">
                  Email:
                </span>{" "}
                <a
                  href={`mailto:${customerEmail}`}
                  className="text-primary hover:underline"
                >
                  {customerEmail}
                </a>
              </div>
            )}
            {i.contract_id && (
              <div>
                <span className="font-semibold text-muted-foreground">
                  Contrato:
                </span>{" "}
                <Link
                  href={`/contratos/${i.contract_id}`}
                  className="font-bold text-primary hover:underline"
                >
                  Ver contrato →
                </Link>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {i.status === "completed"
                  ? `Equipos instalados (${items.length})`
                  : `Equipos a instalar (${items.length})`}
              </CardTitle>
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
                <PhotoGallery photos={photosFull} />
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
                          {new Date(s.signed_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                          {s.context
                            ? ` · ${
                                s.context === "final"
                                  ? "Firma final"
                                  : s.context === "initial_state"
                                    ? "Estado inicial"
                                    : s.context
                              }`
                            : ""}
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
                  {i.started_at && new Date(i.started_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                </div>
                <div>
                  <strong>Completado:</strong>{" "}
                  {new Date(i.completed_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
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
                  {new Date(i.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                </div>
              )}
              {/* Estado inicial: SOLO se conoce tras iniciar el parte
                  (decisión 2026-05-19). Antes de iniciar no tiene sentido
                  mostrarlo — el técnico aún no ha visto el sitio. */}
              {i.started_at && (
                <>
                  <div>
                    <strong>Daños previos:</strong>{" "}
                    {i.has_previous_damage ? "Sí" : "No"}
                  </div>
                  <div>
                    <strong>Agujero encimera:</strong>{" "}
                    {i.needs_countertop_drilling ? "Sí" : "No"}
                  </div>
                </>
              )}
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
          {canReassign && i.status !== "completed" && i.status !== "cancelled" && (
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
