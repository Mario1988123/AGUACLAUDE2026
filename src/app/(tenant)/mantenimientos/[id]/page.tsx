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
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { esSoloTecnico } from "@/shared/lib/auth/role-scope";
import { BackButton } from "@/shared/components/back-button";
import {
  cargarDatosHojaIdentificar,
  cargarEquiposConModelo,
  modeloEquipoDisponible,
} from "@/modules/equipos-modelo/datos";
import { TarjetaIdentificarMantenimiento } from "@/modules/equipos-modelo/boton-identificar";
import { cargarMantVisita } from "@/modules/mant-incluido/datos";
import { BannerCobroVisita } from "@/modules/mant-incluido/banner-visita";
import { BotonPagoOficina } from "@/modules/mant-incluido/boton-pago-oficina";
import type { ConfigCobroCierre } from "@/modules/mant-incluido/bloque-cobro";
import { esNivel12 } from "@/shared/lib/auth/role-scope";

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
  const session = await requireSession();
  // Un técnico NO ve los mantenimientos de otro (D2, 2026-11-12).
  if (esSoloTecnico(session) && job.technician_user_id !== session.user_id) {
    notFound();
  }

  // Customer name lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Cliente y dirección con admin + company_id (2026-11-12): con el cliente
  // RLS el técnico veía «—». Ya está autorizado a ver este trabajo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;
  const { data: c } = await adm
    .from("customers")
    .select("party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
    .eq("id", job.customer_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const cu = (c ?? {}) as {
    phone_primary?: string | null;
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

  // Modelo de equipo (plan 2026-11-13). Solo si la migración está aplicada.
  const hayModelo = await modeloEquipoDisponible();
  const abierto = job.status !== "completed" && job.status !== "cancelled";
  let modeloEtiqueta: string | null = null;
  let identificacionPendiente = false;
  let tipoEquipo: "fuente" | "osmosis" | null = null;
  let hojaDatos: Awaited<ReturnType<typeof cargarDatosHojaIdentificar>> | null = null;
  if (hayModelo && session.company_id) {
    if (job.customer_equipment_id) {
      const [eqm] = await cargarEquiposConModelo(session.company_id, {
        equipoIds: [job.customer_equipment_id],
        incluirInactivos: true,
      });
      if (eqm) {
        modeloEtiqueta = eqm.etiqueta;
        identificacionPendiente = eqm.estado.pendiente;
        tipoEquipo = eqm.estado.tipo;
      }
    } else {
      identificacionPendiente = true;
    }
    if (identificacionPendiente && abierto) {
      hojaDatos = await cargarDatosHojaIdentificar(session.company_id, job.customer_id);
    }
  }
  // Sin equipo en el trabajo: si el cliente ya tiene equipos, que elija cuál;
  // si no tiene ninguno, se da de alta al identificar.
  const equipoParaHoja: string | null | undefined = job.customer_equipment_id
    ? job.customer_equipment_id
    : hojaDatos && hojaDatos.equipos.length > 0
      ? undefined
      : null;

  // Mantenimientos incluidos (plan 2026-11-12): estado de cobro de la visita.
  // Null si la migración no está aplicada → la ficha queda como siempre.
  const mantVisita = session.company_id
    ? await cargarMantVisita(session.company_id, job.id).catch(() => null)
    : null;
  const preciosVisita = {
    solo_filtros: mantVisita?.resumen?.aplicado.solo_filtros.cents ?? null,
    filtros_membrana: mantVisita?.resumen?.aplicado.filtros_membrana.cents ?? null,
  };
  const cobroCierre: ConfigCobroCierre | null =
    mantVisita && job.status === "in_progress"
      ? mantVisita.pagoEfectivo === "pendiente"
        ? {
            modo: "cobrar",
            precios: preciosVisita,
            iva: mantVisita.resumen?.iva ?? 21,
            pagadoTarifa: null,
            pagadoCents: null,
          }
        : mantVisita.pagoEfectivo === "pagado_oficina" && preciosVisita.filtros_membrana != null
          ? {
              modo: "oficina",
              precios: preciosVisita,
              iva: mantVisita.resumen?.iva ?? 21,
              pagadoTarifa: mantVisita.pagadoOficina?.tarifa ?? null,
              pagadoCents: mantVisita.pagadoOficina?.cents ?? null,
            }
          : null
      : null;
  const puedeMarcarPagado = esNivel12(session);
  const modoPagoOficina: "marcar" | "quitar" | null = !mantVisita || !puedeMarcarPagado
    ? null
    : mantVisita.pagoEfectivo === "pendiente" || mantVisita.pagoEfectivo === "no_cobrado"
      ? "marcar"
      : mantVisita.pagoEfectivo === "pagado_oficina" && abierto
        ? "quitar"
        : null;

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
    const { data } = await adm
      .from("addresses")
      .select(addrCols)
      .eq("company_id", session.company_id)
      .eq("id", targetAddrId)
      .is("deleted_at", null)
      .maybeSingle();
    addrRow = (data as AddrRow | null) ?? null;
  }
  if (!addrRow && job.customer_id) {
    const { data } = await adm
      .from("addresses")
      .select(addrCols)
      .eq("company_id", session.company_id)
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

      <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-3">
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
            {cu.phone_primary && (
              <>
                {" · "}
                <a href={`tel:${cu.phone_primary.replace(/[^0-9+]/g, "")}`} className="font-semibold text-primary underline">
                  {cu.phone_primary}
                </a>
              </>
            )}
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

      {mantVisita &&
        (mantVisita.pagoEfectivo !== "incluido" ||
          (abierto && mantVisita.resumen?.estado === "ultima_incluida")) && (
        <div className="space-y-2">
          <BannerCobroVisita visita={mantVisita} abierta={abierto} />
          {modoPagoOficina && (
            <BotonPagoOficina jobId={job.id} modo={modoPagoOficina} precios={preciosVisita} />
          )}
        </div>
      )}

      {hojaDatos && identificacionPendiente && (
        <TarjetaIdentificarMantenimiento
          datos={hojaDatos}
          customerId={job.customer_id}
          maintenanceJobId={job.id}
          equipoId={equipoParaHoja}
          tipoInicial={tipoEquipo}
          texto={
            job.customer_equipment_id
              ? `${modeloEtiqueta ?? "Equipo"}. Di qué modelo es: queda guardado para siempre.`
              : "Este mantenimiento no tiene equipo. Di cuál es: queda guardado para siempre."
          }
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
              {modeloEtiqueta && (
                <div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                      identificacionPendiente
                        ? "bg-amber-100 text-amber-900"
                        : tipoEquipo === "osmosis"
                          ? "bg-teal-100 text-teal-900"
                          : "bg-sky-100 text-sky-900"
                    }`}
                  >
                    {modeloEtiqueta}
                  </span>
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
                {mantVisita?.pagoEfectivo === "pendiente" && !job.is_charged
                  ? "A cobrar en la visita"
                  : job.is_charged
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
                      <li key={r.id} className="flex justify-between gap-3 border-b py-2">
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
                identificacionPendiente={hayModelo && identificacionPendiente}
                pedirAlcance={hayModelo && !identificacionPendiente && tipoEquipo === "osmosis"}
                cobro={cobroCierre}
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
