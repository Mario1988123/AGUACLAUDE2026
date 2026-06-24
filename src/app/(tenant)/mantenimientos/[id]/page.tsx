import Link from "next/link";
import { notFound } from "next/navigation";
import { getMaintenance } from "@/modules/maintenance/actions";
import { computeMaintenanceJobAlerts } from "@/modules/maintenance/alerts";
import { MaintenanceAlertsModal } from "@/modules/maintenance/alerts-modal";
import { listProducts } from "@/modules/products/actions";
import { STATUS_LABEL, STATUS_VARIANT, KIND_LABEL } from "@/modules/maintenance/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Timeline } from "@/modules/events/timeline";
import { MaintenanceCompleteForm } from "@/modules/maintenance/complete-form";
import { StartMaintenanceButton } from "@/modules/maintenance/start-button";
import { ReassignMaintenanceButton } from "@/modules/maintenance/reassign-button";
import { listInstallers } from "@/modules/agenda/actions";
import { listMaintenancePlans } from "@/modules/maintenance-plans/actions";
import { requireSession } from "@/shared/lib/auth/session";
import { createClient } from "@/shared/lib/supabase/server";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let job;
  try {
    job = await getMaintenance(id);
  } catch {
    notFound();
  }

  // Customer name lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: c } = await supabase
    .from("customers")
    .select("party_kind, legal_name, trade_name, first_name, last_name")
    .eq("id", job.customer_id)
    .single();
  const cu = (c ?? {}) as {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
  const customerName =
    cu.party_kind === "company"
      ? cu.trade_name || cu.legal_name || "—"
      : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() || "—";

  // Equipo del mantenimiento (nombre) + su dirección, para que el técnico vea
  // DÓNDE va sin entrar a la ficha del cliente.
  let equipmentName: string | null = null;
  let equipmentAddrId: string | null = null;
  if (job.customer_equipment_id) {
    const { data: eq } = await supabase
      .from("customer_equipment")
      .select("product_id, external_equipment_model_id, address_id, serial_number")
      .eq("id", job.customer_equipment_id)
      .maybeSingle();
    const e = eq as {
      product_id: string | null;
      external_equipment_model_id: string | null;
      address_id: string | null;
      serial_number: string | null;
    } | null;
    if (e) {
      equipmentAddrId = e.address_id;
      if (e.product_id) {
        const { data: p } = await supabase
          .from("products")
          .select("name")
          .eq("id", e.product_id)
          .maybeSingle();
        equipmentName = (p as { name: string } | null)?.name ?? null;
      } else if (e.external_equipment_model_id) {
        const { data: m } = await supabase
          .from("external_equipment_models")
          .select("brand, model")
          .eq("id", e.external_equipment_model_id)
          .maybeSingle();
        const mm = m as { brand: string | null; model: string | null } | null;
        if (mm) equipmentName = `${mm.brand ?? ""} ${mm.model ?? ""}`.trim() || null;
      }
      if (e.serial_number) equipmentName = `${equipmentName ?? "Equipo"} · ${e.serial_number}`;
    }
  }

  // Dirección concreta del job (defensivo: address_id es columna nueva).
  let jobAddressId: string | null = null;
  try {
    const { data } = await supabase
      .from("maintenance_jobs")
      .select("address_id")
      .eq("id", id)
      .maybeSingle();
    jobAddressId = (data as { address_id: string | null } | null)?.address_id ?? null;
  } catch {
    /* columna aún no disponible */
  }

  // Dirección a mostrar: job.address_id → equipo.address_id → principal cliente.
  type AddrRow = {
    label: string | null;
    street_type: string | null;
    street: string | null;
    street_number: string | null;
    portal: string | null;
    floor: string | null;
    door: string | null;
    postal_code: string | null;
    city: string | null;
    province: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  const addrCols =
    "label, street_type, street, street_number, portal, floor, door, postal_code, city, province, latitude, longitude";
  let addrRow: AddrRow | null = null;
  const targetAddrId = jobAddressId ?? equipmentAddrId ?? null;
  if (targetAddrId) {
    const { data } = await supabase
      .from("addresses")
      .select(addrCols)
      .eq("id", targetAddrId)
      .is("deleted_at", null)
      .maybeSingle();
    addrRow = (data as AddrRow | null) ?? null;
  }
  if (!addrRow && job.customer_id) {
    const { data } = await supabase
      .from("addresses")
      .select(addrCols)
      .eq("customer_id", job.customer_id)
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    addrRow = (data as AddrRow | null) ?? null;
  }
  const addressText = addrRow
    ? (() => {
        const street = [
          addrRow.street_type,
          addrRow.street,
          addrRow.street_number,
          addrRow.portal,
          addrRow.floor,
          addrRow.door,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        const locality = [addrRow.postal_code, addrRow.city, addrRow.province]
          .filter(Boolean)
          .join(" ");
        return [street, locality].filter(Boolean).join(", ") || null;
      })()
    : null;
  const mapsUrl =
    addrRow && addrRow.latitude != null && addrRow.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${addrRow.latitude},${addrRow.longitude}`
      : addressText
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`
        : null;

  const products = await listProducts().catch(() => []);
  const session = await requireSession();
  const canReassign =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  const technicians = canReassign
    ? await listInstallers().catch(() => [])
    : [];

  // Planes de mantenimiento disponibles — usados por complete-form
  // para ofrecer renovación al cliente tras la última visita del contrato.
  const maintenancePlans = await listMaintenancePlans().catch(() => []);

  // Avisos operativos del mantenimiento — patrón badge+modal idéntico al
  // de clientes / instalaciones. Se calculan a partir de columnas del job
  // (retraso, sin técnico, en curso >4h, propuesta sin confirmar, etc.).
  const jobAlerts = computeMaintenanceJobAlerts({
    status: job.status,
    scheduled_at: job.scheduled_at,
    started_at: job.started_at,
    technician_user_id: job.technician_user_id,
    customer_called_at: job.customer_called_at,
    confirmed_at: job.confirmed_at,
  });

  // Items reemplazados ya registrados (si completado)
  const { data: replaced } = await supabase
    .from("maintenance_items_replaced")
    .select("id, product_id, quantity")
    .eq("maintenance_job_id", id);
  const replacedList = (replaced ?? []) as Array<{
    id: string;
    product_id: string;
    quantity: number;
  }>;

  return (
    <div className="space-y-6">
      {/* Modal auto-abrir con avisos operativos al entrar a la ficha */}
      <MaintenanceAlertsModal maintenanceId={id} alerts={jobAlerts} />

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Mantenimiento</h1>
            <Badge variant={STATUS_VARIANT[job.status] ?? "default"}>
              {STATUS_LABEL[job.status] ?? job.status}
            </Badge>
            <Badge variant="outline">{KIND_LABEL[job.kind] ?? job.kind}</Badge>
            {jobAlerts.length > 0 && (
              <span
                className="inline-flex h-6 items-center rounded-full bg-red-100 px-2 text-xs font-bold text-red-800"
                title={jobAlerts.join(" · ")}
              >
                ⚠ {jobAlerts.length} aviso{jobAlerts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cliente: <strong>{customerName}</strong>
            {job.scheduled_at &&
              ` · Programado ${new Date(job.scheduled_at).toLocaleString("es-ES")}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReassign && job.status !== "completed" && (
            <ReassignMaintenanceButton
              maintenanceId={id}
              currentUserId={job.technician_user_id}
              technicians={technicians}
            />
          )}
          <BackButton href="/mantenimientos" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {equipmentName && (
                <div>
                  <strong>Equipo:</strong> {equipmentName}
                </div>
              )}
              {addressText && (
                <div>
                  <strong>Dirección:</strong>{" "}
                  {addrRow?.label ? `${addrRow.label} · ` : ""}
                  {addressText}
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-primary underline"
                    >
                      Ver en Google Maps
                    </a>
                  )}
                </div>
              )}
              {job.started_at && (
                <div>
                  <strong>Iniciado:</strong> {new Date(job.started_at).toLocaleString("es-ES")}
                </div>
              )}
              {job.completed_at && (
                <div>
                  <strong>Completado:</strong>{" "}
                  {new Date(job.completed_at).toLocaleString("es-ES")}
                </div>
              )}
              {job.duration_seconds && (
                <div>
                  <strong>Duración:</strong> {Math.round(job.duration_seconds / 60)} min
                </div>
              )}
              <div>
                <strong>Cargo:</strong>{" "}
                {job.is_charged
                  ? new Intl.NumberFormat("es-ES", {
                      style: "currency",
                      currency: "EUR",
                    }).format((job.charge_cents ?? 0) / 100)
                  : "Incluido en contrato"}
              </div>
              {job.notes && (
                <div>
                  <strong>Notas:</strong> {job.notes}
                </div>
              )}
            </CardContent>
          </Card>

          {replacedList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recambios utilizados</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {replacedList.map((r) => {
                    const p = products.find((pp) => pp.id === r.product_id);
                    return (
                      <li key={r.id} className="flex justify-between border-b py-2">
                        <span>{p?.name ?? r.product_id.slice(0, 8)}</span>
                        <Badge variant="secondary">x{r.quantity}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            {job.status === "scheduled" && <StartMaintenanceButton id={job.id} />}
            {job.status === "in_progress" && (
              <MaintenanceCompleteForm
                maintenanceId={job.id}
                products={products.map((p) => ({ id: p.id, name: p.name }))}
                maintenancePlans={maintenancePlans.map((p) => ({
                  id: p.id,
                  name: p.name,
                  tier: p.tier,
                  monthly_cents: p.monthly_cents,
                }))}
              />
            )}
            {job.status === "completed" && (
              <p className="text-sm text-success">✓ Mantenimiento completado</p>
            )}
            {job.status === "cancelled" && (
              <p className="text-sm text-destructive">Mantenimiento cancelado</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline subjectType="maintenance" subjectId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
