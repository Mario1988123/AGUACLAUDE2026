import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "@/modules/customers/actions";
import { listAddresses } from "@/modules/addresses/actions";
import { AddressList } from "@/modules/addresses/address-list";
import { listBankAccounts } from "@/modules/customers/bank-accounts/actions";
import { BankAccountList } from "@/modules/customers/bank-accounts/bank-list";
import { listCustomerMandates, getGoCardlessSettings } from "@/modules/gocardless/actions";
import { CustomerMandatesPanel } from "@/modules/gocardless/customer-mandates-panel";
import { listCustomerEquipment } from "@/modules/customers/equipment-actions";
import { CustomerEquipmentList } from "@/modules/customers/equipment-list";
import { AddEquipmentButton } from "@/modules/customers/add-equipment-button";
import { UninstallEquipmentButton } from "@/modules/customers/uninstall-button";
import { CreateMaintenanceButton } from "@/modules/customers/create-maintenance-button";
import { DeleteCustomerButton } from "@/modules/customers/delete-customer-button";
import { listInstallers } from "@/modules/agenda/actions";
import { CustomerConsentsCard } from "@/modules/customers/consents-card";
import { getCustomerConsents } from "@/modules/customers/consents-actions";
import { listProposalsByCustomer } from "@/modules/proposals/actions";
import { BackButton } from "@/shared/components/back-button";
import { ProposalsCard } from "@/modules/proposals/proposals-card";
import {
  listContractsByCustomer,
  listInstallationsByCustomer,
  getCustomerAlertsDetail,
} from "@/modules/customers/actions";
import { CustomerAlertsModal } from "@/modules/customers/alerts-modal";
import { CustomerContractsCard } from "@/modules/customers/contracts-card";
import { CustomerInstallationsCard } from "@/modules/customers/installations-card";
import { CustomerContactButtons } from "@/modules/customers/contact-buttons";
import { EditCustomerDataButton } from "@/modules/customers/edit-data-button";
import { FromProposalBanner } from "@/modules/customers/from-proposal-banner";
import { Timeline } from "@/modules/events/timeline";
import { StreetViewCard } from "@/shared/components/street-view-card";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CustomerKPIHeader, getCustomerKPIs } from "@/modules/customers/kpi-header";
import { CustomerRGPDPanel } from "@/modules/customers/rgpd-panel";
import { getCustomerMaintenanceHistory } from "@/modules/customers/maintenance-history-card";
import { MaintenanceByEquipmentCard } from "@/modules/customers/maintenance-by-equipment-card";
import { CustomerTagsSelector } from "@/modules/customers/tags-selector";
import {
  listCustomerTags,
  listTagsCatalog,
} from "@/modules/customers/tags-actions";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from_proposal?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fromProposal = sp.from_proposal;
  let customer;
  try {
    customer = await getCustomer(id);
  } catch {
    notFound();
  }

  const displayName =
    customer.party_kind === "company"
      ? customer.trade_name || customer.legal_name || "Sin nombre"
      : `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || "Sin nombre";

  const session = await requireSession();
  // Scope check: nivel 2/3 solo accede a sus clientes (created_by ∈ visibleUserIds).
  {
    const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
    const visibleUserIds = await resolveVisibleUserIds(session);
    if (visibleUserIds !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cust = customer as any;
      const inScope = cust.created_by && visibleUserIds.includes(cust.created_by);
      if (!inScope) notFound();
    }
  }
  const addresses = await listAddresses({ customer_id: id });
  const canSeeBank = session.is_superadmin || session.roles.includes("company_admin");
  const bankAccounts = canSeeBank ? await listBankAccounts(id).catch(() => []) : [];
  const equipment = await listCustomerEquipment(id).catch(() => []);
  // Planes de mantenimiento + equipos con contrato activo para que la
  // lista de equipos pueda mostrar el botón "Ofrecer contrato" solo
  // donde tiene sentido (equipos sin cobertura).
  const { listMaintenancePlans, getEquipmentsWithActiveMaintenanceContract } =
    await import("@/modules/maintenance-plans/actions");
  const [maintenancePlans, equipmentsWithActiveContract] = await Promise.all([
    listMaintenancePlans().catch(() => []),
    getEquipmentsWithActiveMaintenanceContract(id).catch(() => new Set<string>()),
  ]);
  // Almacenes para destino al desinstalar (sugiere el marcado como
  // is_used_equipment_default si existe).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbWh = (await (await import("@/shared/lib/supabase/server")).createClient()) as any;
  const { data: whRows } = await sbWh
    .from("warehouses")
    .select("id, name, is_used_equipment_default")
    .is("deleted_at", null)
    .order("kind")
    .order("name");
  const warehouseOptions = ((whRows ?? []) as Array<{
    id: string;
    name: string;
    is_used_equipment_default?: boolean;
  }>).map((w) => ({
    id: w.id,
    name: w.name,
    is_used_default: !!w.is_used_equipment_default,
  }));
  const [gcSettings, mandates] = await Promise.all([
    getGoCardlessSettings().catch(() => ({ configured: false, environment: null, enabled: false, hasWebhookSecret: false })),
    listCustomerMandates(id).catch(() => []),
  ]);

  // Productos del catálogo para el botón "Añadir equipo"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbProds = (await (await import("@/shared/lib/supabase/server")).createClient()) as any;
  const { data: prodList } = await sbProds
    .from("products")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");
  const ownProductsForEquipment = ((prodList ?? []) as Array<{ id: string; name: string }>);
  const customerProposals = await listProposalsByCustomer(id).catch(() => []);
  const contracts = await listContractsByCustomer(id).catch(() => []);
  // Avisos abiertos del cliente (mantenimiento vencido, incidencias…).
  // Se muestran como modal emergente al cargar la ficha.
  const customerAlerts = await getCustomerAlertsDetail(id).catch(() => []);
  const installations = await listInstallationsByCustomer(id).catch(() => []);
  const customerConsents = await getCustomerConsents(id).catch(() => []);
  const kpis = await getCustomerKPIs(id).catch(() => null);
  const maintenanceHistory = await getCustomerMaintenanceHistory(id).catch(() => []);
  const [tagsCatalog, tagsAssigned] = await Promise.all([
    listTagsCatalog().catch(() => []),
    listCustomerTags(id).catch(() => []),
  ]);

  // Técnicos (para "programar retirada" en mantenimiento y al borrar cliente).
  const technicians = await listInstallers().catch(() => []);

  // Datos para "Borrar cliente" (solo admin). Sugerimos retirar la máquina si
  // el cliente tiene algún contrato de alquiler/renting (la máquina sigue
  // siendo nuestra); en contado se sugiere "se queda" (la compró).
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  const suggestRemove = contracts.some(
    (k) =>
      (k as { plan_type?: string }).plan_type === "rental" ||
      (k as { plan_type?: string }).plan_type === "renting",
  );
  const activeEquipmentForDelete = equipment
    .filter((e) => e.is_active)
    .map((e) => ({
      id: e.id,
      display_name: e.product_name ?? e.external_model_name ?? "Equipo",
      serial_number: e.serial_number,
      is_ours: !!e.product_name,
    }));

  // Bandera "cliente en riesgo": incidencia abierta con prioridad
  // critical/high + al menos un contrato activo.
  let isAtRisk = false;
  let atRiskCount = 0;
  try {
    const hasActiveContract = contracts.some(
      (k) => k.status === "active" || k.status === "signed",
    );
    if (hasActiveContract) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sbRisk = (await (await import("@/shared/lib/supabase/server")).createClient()) as any;
      const { count } = await sbRisk
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", id)
        .in("priority", ["critical", "high"])
        .in("status", ["open", "assigned", "in_progress"]);
      atRiskCount = count ?? 0;
      isAtRisk = atRiskCount > 0;
    }
  } catch {
    /* fail-soft */
  }

  // Resolver nombre del comercial asignado
  let assignedName: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = customer as any;
  if (c.assigned_user_id) {
    const { createClient: cc } = await import("@/shared/lib/supabase/server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (await cc()) as any;
    const { data: prof } = await sb
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", c.assigned_user_id)
      .maybeSingle();
    assignedName = (prof as { full_name: string | null } | null)?.full_name ?? null;
  }

  // Pendientes para el banner si venimos desde una propuesta aceptada
  // IBAN cuenta como "completo" si hay al menos una cuenta validada (no
  // placeholder ES00). Las cuentas pendientes permiten firmar pero el
  // banner sigue avisando para que el comercial pida el IBAN real.
  const hasValidatedBank = bankAccounts.some((b) => b.is_validated);
  const pendingFromProposal = fromProposal
    ? {
        dni: !customer.tax_id,
        iban: !hasValidatedBank,
        address: addresses.length === 0,
      }
    : null;

  // Aviso informativo persistente de datos del cliente que faltan.
  // No bloquea nada, solo recuerda al comercial qué pedirle al cliente
  // para no encontrarse el problema cuando llegue el contrato/firma.
  const missingFields: string[] = [];
  if (!customer.tax_id) missingFields.push("DNI/CIF");
  if (!customer.email) missingFields.push("email");
  if (!hasValidatedBank) missingFields.push("IBAN validado");
  if (addresses.length === 0) missingFields.push("dirección");

  return (
    <div className="space-y-6">
      {/* Modal automático con avisos abiertos del cliente. Se muestra al
          cargar la ficha si hay avisos (1 vez por día por sesión). Si no
          hay avisos, no renderiza nada. */}
      <CustomerAlertsModal customerId={id} alerts={customerAlerts} />

      {fromProposal && pendingFromProposal && (
        <FromProposalBanner proposalId={fromProposal} pending={pendingFromProposal} />
      )}
      {missingFields.length > 0 && !fromProposal && (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900">
            ℹ
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-amber-900">Datos del cliente incompletos</h3>
            <p className="mt-0.5 text-sm text-amber-800">
              Faltan: <strong>{missingFields.join(", ")}</strong>. Es informativo —
              no bloquea, pero conviene completarlo antes de generar contrato o
              lanzar remesa.
            </p>
          </div>
        </div>
      )}
      {kpis && <CustomerKPIHeader kpis={kpis} />}

      {/* Cabecera reorganizada: BackButton arriba, título+badges, después acciones.
          En móvil/tablet las acciones quedan debajo y se apilan limpias. */}
      <div className="space-y-3">
        <BackButton href="/clientes" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-extrabold tracking-tight sm:text-3xl">
                {displayName}
              </h1>
              {customer.is_active ? (
                <Badge variant="success">Activo</Badge>
              ) : (
                <Badge variant="secondary">Inactivo</Badge>
              )}
              {isAtRisk && (
                <Badge variant="destructive" title="Incidencias críticas o altas abiertas con contrato activo">
                  ⚠ En riesgo ({atRiskCount})
                </Badge>
              )}
              {/* Tags compactos al lado de los badges. Ya no ocupan fila propia. */}
              <CustomerTagsSelector
                customerId={id}
                catalog={tagsCatalog}
                assigned={tagsAssigned}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {customer.party_kind === "company" ? "Empresa" : "Particular"}
              {customer.external_code && ` · Nº ${customer.external_code}`}
              {customer.tax_id && ` · ${customer.tax_id}`}
              {assignedName && (
                <>
                  {" · "}Asignado a <strong className="text-foreground">{assignedName}</strong>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
            <Link
              href={`/propuestas/nueva?customer_id=${id}` as never}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Nueva propuesta
            </Link>
            <Link
              href={`/propuestas/nueva?customer_id=${id}&direct=1` as never}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-500 px-3 text-sm font-bold text-white hover:bg-amber-600"
              title="El cliente acepta de palabra — crea propuesta+contrato en un paso"
            >
              ⚡ Contrato directo
            </Link>
            <Link
              href={`/calculadora-ahorro/nueva?customer_id=${id}` as never}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
              title="Calcular el ahorro vs su consumo actual"
            >
              📊 Calcular
            </Link>
            <Link
              href={`/pruebas-gratuitas/nueva?customer_id=${id}` as never}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
              title="Entregar equipo en prueba sin contrato"
            >
              🎁 Prueba
            </Link>
            {isAdmin && (
              <DeleteCustomerButton
                customerId={id}
                equipment={activeEquipmentForDelete}
                warehouses={warehouseOptions}
                technicians={technicians}
                suggestRemove={suggestRemove}
              />
            )}
          </div>
        </div>
      </div>

      <CustomerContactButtons
        customerId={id}
        phone={customer.phone_primary}
        email={customer.email}
        recipientName={displayName}
        commercialName={session.full_name}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Datos</CardTitle>
              <EditCustomerDataButton
                customerId={id}
                initial={{
                  party_kind: customer.party_kind,
                  legal_name: customer.legal_name,
                  trade_name: customer.trade_name,
                  first_name: customer.first_name,
                  last_name: customer.last_name,
                  email: customer.email,
                  phone_primary: customer.phone_primary,
                  phone_secondary: customer.phone_secondary,
                  tax_id: customer.tax_id,
                  notes: customer.notes,
                }}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Tipo" value={customer.party_kind === "company" ? "Empresa" : "Particular"} />
            {customer.party_kind === "company" ? (
              <>
                <Row label="Razón social" value={customer.legal_name} />
                <Row label="Nombre comercial" value={customer.trade_name} />
                <Row label="CIF" value={customer.tax_id} />
              </>
            ) : (
              <>
                <Row label="Nombre" value={customer.first_name} />
                <Row label="Apellidos" value={customer.last_name} />
                <Row label="DNI/NIE" value={customer.tax_id} />
              </>
            )}
            <Row label="Email" value={customer.email} />
            <Row label="Teléfono" value={customer.phone_primary} />
            <Row label="Tel. secundario" value={customer.phone_secondary} />
            {customer.notes && (
              <div className="border-t pt-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notas</div>
                <p className="mt-1 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direcciones ({addresses.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AddressList
              customerId={id}
              addresses={addresses}
              equipmentByAddress={(() => {
                const acc: Record<string, number> = {};
                for (const e of equipment) {
                  if (e.address_id) {
                    acc[e.address_id] = (acc[e.address_id] ?? 0) + 1;
                  }
                }
                return acc;
              })()}
            />
            {(() => {
              const primary =
                addresses.find((a) => a.is_primary) ?? addresses[0];
              if (
                !primary ||
                primary.latitude == null ||
                primary.longitude == null
              )
                return null;
              return (
                <StreetViewCard
                  lat={Number(primary.latitude)}
                  lng={Number(primary.longitude)}
                  label="dirección principal"
                />
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos bancarios{canSeeBank ? ` (${bankAccounts.length})` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            {canSeeBank ? (
              <BankAccountList
                customerId={id}
                accounts={bankAccounts}
                defaultHolderName={displayName}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                🔒 Solo el administrador de la empresa puede ver los datos bancarios.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Domiciliación GoCardless: sólo se muestra si la empresa lo
            tiene configurado, habilitado, Y el cliente tiene al menos un
            contrato de ALQUILER activo (única modalidad con cuotas que se
            cobran por SEPA). En renting cobra la financiera, en contado
            es pago único — no aplica domiciliación. Decisión 2026-06-02. */}
        {gcSettings.configured &&
          gcSettings.enabled &&
          contracts.some(
            (k) =>
              (k.status === "active" || k.status === "signed") &&
              (k as { plan_type?: string }).plan_type === "rental",
          ) && (
            <Card>
              <CardHeader>
                <CardTitle>Domiciliación GoCardless ({mandates.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomerMandatesPanel
                  customerId={id}
                  mandates={mandates}
                  configured
                />
              </CardContent>
            </Card>
          )}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span>Equipos instalados ({equipment.length})</span>
              <div className="flex items-center gap-2 flex-wrap">
                {(session.is_superadmin ||
                  session.roles.includes("company_admin") ||
                  session.roles.includes("technical_director")) &&
                  equipment.some((e) => e.is_active) && (
                    <>
                      <CreateMaintenanceButton
                        customerId={id}
                        equipment={equipment
                          .filter((e) => e.is_active)
                          .map((e) => ({
                            id: e.id,
                            display_name:
                              e.product_name ?? e.external_model_name ?? "Equipo",
                          }))}
                        technicians={technicians}
                      />
                      <UninstallEquipmentButton
                        customerId={id}
                        equipment={equipment
                          .filter((e) => e.is_active)
                          .map((e) => ({
                            id: e.id,
                            display_name:
                              e.product_name ?? e.external_model_name ?? "Equipo",
                            serial_number: e.serial_number,
                            is_ours: !!e.product_name,
                          }))}
                        warehouses={warehouseOptions}
                      />
                    </>
                  )}
                <AddEquipmentButton
                  customerId={id}
                  ownProducts={ownProductsForEquipment}
                  addresses={addresses.map((a) => ({
                    id: a.id,
                    label:
                      [a.street_type, a.street, a.street_number, a.city]
                        .filter(Boolean)
                        .join(" ") ||
                      a.label ||
                      "Dirección",
                    is_primary: a.is_primary,
                  }))}
                />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerEquipmentList
              equipment={equipment}
              customerId={id}
              addresses={addresses.map((a) => ({
                id: a.id,
                label: [
                  a.label,
                  a.street_type ?? "",
                  a.street ?? "",
                  a.street_number ?? "",
                  a.city ? `· ${a.city}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")
                  .trim() || "Dirección",
              }))}
              canRelocate={
                session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("technical_director") ||
                session.roles.includes("commercial_director")
              }
              canEditModality={
                session.is_superadmin ||
                session.roles.includes("company_admin") ||
                session.roles.includes("technical_director") ||
                session.roles.includes("commercial_director")
              }
              maintenancePlans={maintenancePlans}
              equipmentsWithActiveContract={equipmentsWithActiveContract}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Propuestas ({customerProposals.length})</CardTitle>
              <Button asChild size="sm">
                <Link href={`/propuestas/nueva?customer_id=${id}` as never}>
                  <Plus className="h-4 w-4" /> Nueva propuesta
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ProposalsCard proposals={customerProposals} scope="customer" />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contratos ({contracts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerContractsCard contracts={contracts} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Instalaciones ({installations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerInstallationsCard installations={installations} />
          </CardContent>
        </Card>
      </div>

      {/* Mantenimientos por equipo (2026-06-02). Movido aquí, justo
          después de Instalaciones — antes de los bloques RGPD que son
          más administrativos. Más útil tener cerca lo operativo. */}
      <MaintenanceByEquipmentCard
        customerId={id}
        equipment={equipment}
        history={maintenanceHistory}
      />

      <CustomerConsentsCard customerId={id} consents={customerConsents} />

      {/* RGPD unificado (decisión 2026-05-24): antes había dos tarjetas
          casi idénticas — RgpdCard y RGPDPanel. Unificadas en una sola
          con la copy de derechos del cliente + funcionalidad export +
          anonimizar, ambas para admin de empresa. */}
      {(session.is_superadmin || session.roles.includes("company_admin")) && (
        <CustomerRGPDPanel customerId={id} customerName={displayName} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="customer" subjectId={id} enriched />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string | null; value: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2">{value || "—"}</div>
    </div>
  );
}
