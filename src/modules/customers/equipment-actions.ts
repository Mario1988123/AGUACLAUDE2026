"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { madridLocalToUtcISO } from "@/shared/lib/format-date";
import {
  HORA_LLAMADA,
  descripcionLlamada,
  programacionMantenimiento,
  type OrigenAltaEquipo,
  diaLlamada,
  tituloLlamada,
} from "./alta-equipo-logica";
import { cargarEquiposConModelo, modeloEquipoDisponible } from "@/modules/equipos-modelo/datos";
import { cargarMantEquipos, type ResumenMant } from "@/modules/mant-incluido/datos";

export interface CustomerEquipmentRow {
  id: string;
  customer_id: string;
  product_id: string | null;
  address_id: string | null;
  serial_number: string | null;
  installed_at: string | null;
  warranty_until: string | null;
  is_active: boolean;
  notes: string | null;
  product_name: string | null;
  external_model_name: string | null;
  address_label: string | null;
  installation_id: string | null;
  last_maintenance_at: string | null;
  /** Próximo mantenimiento programado (scheduled/preprogrammed) — la
   *  ficha del cliente lo muestra como cuenta atrás "en X días". */
  next_maintenance_at: string | null;
  /** Modalidad heredada: 'cash' venta | 'rental' alquiler | 'renting'. */
  acquisition_type: "cash" | "rental" | "renting" | "installed" | null;
  acquisition_amount_cents: number | null;
  acquisition_started_at: string | null;
  /** Pack: id del equipo principal si este equipo es un extra. NULL = principal/suelto. */
  parent_equipment_id: string | null;
  /** Modelo de equipo (plan 2026-11-13). Null si la migración no está aplicada. */
  modelo: {
    etiqueta: string;
    pendiente: boolean;
    tipo: "fuente" | "osmosis" | null;
  } | null;
  /** Mantenimientos incluidos / «EMPEZAR A PAGAR» (plan 2026-11-12). Null si
   *  la migración no está aplicada. */
  mant: ResumenMant | null;
}

export async function listCustomerEquipment(customerId: string): Promise<CustomerEquipmentRow[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // Bug histórico (2026-05-24): pedíamos `addresses(line1, city)` pero
  // la tabla no tiene columna `line1` (usa street_type/street/city/...).
  // Supabase devolvía error y rows=[] aunque el INSERT había funcionado,
  // por eso el usuario veía "0 equipos" tras el toast de éxito.
  // external_equipment_models NO tiene columna `name` — solo brand+model
  // (verificado en migración 20260501121100_products.sql:134-143).
  // El SELECT anterior con `name` rompía el join y devolvía rows=[]
  // aunque el INSERT funcionara, dejando el listado siempre a 0.
  // ROBUSTO (bug recurrente "listado vacío", 3ª vez): NO usamos embeds de
  // PostgREST (product:products / external:... / address:...). Si una sola
  // relación o columna del embed falla, PostgREST tumbaba TODA la query y
  // devolvía [] aunque los equipos existieran. Ahora: SELECT plano de
  // customer_equipment + lookups por id por separado. Un fallo aislado de
  // un lookup nunca vacía la lista; como mucho deja un nombre a null.
  const { data: equipment, error } = await supabase
    .from("customer_equipment")
    .select(
      "id, customer_id, product_id, external_equipment_model_id, address_id, serial_number, installed_at, warranty_until, is_active, notes, installation_id",
    )
    .eq("customer_id", customerId)
    .order("installed_at", { ascending: false });
  if (error) {
    console.error("[listCustomerEquipment] select failed:", error.message);
    return [];
  }

  const rows = (equipment ?? []) as Array<{
    id: string;
    customer_id: string;
    product_id: string | null;
    external_equipment_model_id: string | null;
    address_id: string | null;
    serial_number: string | null;
    installed_at: string | null;
    warranty_until: string | null;
    is_active: boolean;
    notes: string | null;
    installation_id: string | null;
  }>;

  if (rows.length === 0) return [];

  // Lookups por id (independientes y defensivos)
  const uniq = (xs: Array<string | null>) =>
    Array.from(new Set(xs.filter(Boolean))) as string[];
  const productName = new Map<string, string>();
  const externalName = new Map<string, string>();
  const addressLabel = new Map<string, string>();

  const productIds = uniq(rows.map((r) => r.product_id));
  if (productIds.length) {
    const { data } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);
    for (const p of (data ?? []) as Array<{ id: string; name: string }>) {
      productName.set(p.id, p.name);
    }
  }
  const externalIds = uniq(rows.map((r) => r.external_equipment_model_id));
  if (externalIds.length) {
    const { data } = await supabase
      .from("external_equipment_models")
      .select("id, brand, model")
      .in("id", externalIds);
    for (const e of (data ?? []) as Array<{
      id: string;
      brand: string | null;
      model: string | null;
    }>) {
      const label = `${e.brand ?? ""} ${e.model ?? ""}`.trim();
      if (label) externalName.set(e.id, label);
    }
  }
  const addressIds = uniq(rows.map((r) => r.address_id));
  if (addressIds.length) {
    const { data } = await supabase
      .from("addresses")
      .select("id, street_type, street, street_number, city")
      .in("id", addressIds);
    for (const a of (data ?? []) as Array<{
      id: string;
      street_type: string | null;
      street: string | null;
      street_number: string | null;
      city: string | null;
    }>) {
      const label = [a.street_type, a.street, a.street_number, a.city]
        .filter(Boolean)
        .join(" ")
        .replace(/^([a-zñA-ZÑ]+) /, (m) => m.charAt(0).toUpperCase() + m.slice(1));
      if (label) addressLabel.set(a.id, label);
    }
  }

  const ids = rows.map((r) => r.id);
  // Fechas de mantenimiento con admin + company_id (2026-11-12): con la RLS
  // del técnico (solo sus trabajos) salían vacías o mal. Los ids salen de
  // equipos que ya puede ver.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admMant = createAdminClient() as any;
  const { data: maintenance } = await admMant
    .from("maintenance_jobs")
    .select("customer_equipment_id, completed_at")
    .eq("company_id", session.company_id)
    .in("customer_equipment_id", ids)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });

  const lastMaintenance: Record<string, string> = {};
  for (const m of (maintenance ?? []) as Array<{ customer_equipment_id: string; completed_at: string }>) {
    if (!lastMaintenance[m.customer_equipment_id]) {
      lastMaintenance[m.customer_equipment_id] = m.completed_at;
    }
  }

  // Próximo mantenimiento por equipo: primer scheduled/preprogrammed
  // con fecha >= hoy. Útil para mostrar countdown en la ficha cliente.
  const { data: upcoming } = await admMant
    .from("maintenance_jobs")
    .select("customer_equipment_id, scheduled_at")
    .eq("company_id", session.company_id)
    .in("customer_equipment_id", ids)
    .in("status", ["scheduled", "preprogrammed"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });
  const nextMaintenance: Record<string, string> = {};
  for (const m of (upcoming ?? []) as Array<{
    customer_equipment_id: string;
    scheduled_at: string;
  }>) {
    if (!nextMaintenance[m.customer_equipment_id]) {
      nextMaintenance[m.customer_equipment_id] = m.scheduled_at;
    }
  }

  // Modalidad por equipo (defensivo: si la migración aún no está aplicada el
  // select falla y queda vacío — NO tumba la lista, que es plana arriba).
  const acq: Record<
    string,
    { type: "cash" | "rental" | "renting" | "installed" | null; cents: number | null; started: string | null }
  > = {};
  {
    const { data, error } = await supabase
      .from("customer_equipment")
      .select("id, acquisition_type, acquisition_amount_cents, acquisition_started_at")
      .in("id", ids);
    if (!error) {
      for (const a of (data ?? []) as Array<{
        id: string;
        acquisition_type: "cash" | "rental" | "renting" | "installed" | null;
        acquisition_amount_cents: number | null;
        acquisition_started_at: string | null;
      }>) {
        acq[a.id] = {
          type: a.acquisition_type,
          cents: a.acquisition_amount_cents,
          started: a.acquisition_started_at,
        };
      }
    }
  }

  // Vínculo de pack (defensivo: si la columna parent_equipment_id no existe aún
  // porque la migración no se aplicó, se ignora y todos quedan como principales).
  const parentByEq: Record<string, string | null> = {};
  {
    const { data, error } = await supabase
      .from("customer_equipment")
      .select("id, parent_equipment_id")
      .in("id", ids);
    if (!error) {
      for (const p of (data ?? []) as Array<{ id: string; parent_equipment_id: string | null }>) {
        parentByEq[p.id] = p.parent_equipment_id;
      }
    }
  }

  // Modelo de equipo: tipo, gama, variante y si está pendiente (tolerante).
  const modeloPorEq = new Map<string, NonNullable<CustomerEquipmentRow["modelo"]>>();
  if (session.company_id && (await modeloEquipoDisponible())) {
    try {
      const conModelo = await cargarEquiposConModelo(session.company_id, {
        equipoIds: ids,
        incluirInactivos: true,
      });
      for (const m of conModelo) {
        modeloPorEq.set(m.id, {
          etiqueta: m.etiqueta,
          pendiente: m.estado.pendiente,
          tipo: m.estado.tipo,
        });
      }
    } catch (e) {
      console.error("[listCustomerEquipment] modelo:", e);
    }
  }

  // Mantenimientos incluidos (tolerante): estado según la próxima visita.
  let mantPorEq = new Map<string, ResumenMant>();
  if (session.company_id) {
    try {
      mantPorEq = await cargarMantEquipos(session.company_id, ids, nextMaintenance);
    } catch (e) {
      console.error("[listCustomerEquipment] mant incluido:", e);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    customer_id: r.customer_id,
    product_id: r.product_id,
    address_id: r.address_id,
    serial_number: r.serial_number,
    installed_at: r.installed_at,
    warranty_until: r.warranty_until,
    is_active: r.is_active,
    notes: r.notes,
    installation_id: r.installation_id,
    product_name: r.product_id ? (productName.get(r.product_id) ?? null) : null,
    external_model_name: r.external_equipment_model_id
      ? (externalName.get(r.external_equipment_model_id) ?? null)
      : null,
    address_label: r.address_id ? (addressLabel.get(r.address_id) ?? null) : null,
    last_maintenance_at: lastMaintenance[r.id] ?? null,
    next_maintenance_at: nextMaintenance[r.id] ?? null,
    acquisition_type: acq[r.id]?.type ?? null,
    acquisition_amount_cents: acq[r.id]?.cents ?? null,
    acquisition_started_at: acq[r.id]?.started ?? null,
    parent_equipment_id: parentByEq[r.id] ?? null,
    modelo: modeloPorEq.get(r.id) ?? null,
    mant: mantPorEq.get(r.id) ?? null,
  }));
}

/**
 * Guarda/edita la MODALIDAD de un equipo (venta/alquiler/renting + importe +
 * fecha de inicio) directamente desde la ficha, sin recargar el Excel.
 * Admin / dir. comercial / dir. técnico.
 */
export async function setEquipmentModalityAction(input: {
  equipment_id: string;
  acquisition_type: "cash" | "rental" | "renting" | "installed" | null;
  acquisition_amount_cents: number | null;
  acquisition_started_at: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("technical_director");
    if (!isUpper) return { ok: false, error: "Sin permisos" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: eq } = await admin
      .from("customer_equipment")
      .select("id, customer_id, company_id")
      .eq("id", input.equipment_id)
      .maybeSingle();
    const row = eq as { id: string; customer_id: string; company_id: string } | null;
    if (!row || row.company_id !== session.company_id) {
      return { ok: false, error: "Equipo no encontrado o no pertenece a tu empresa" };
    }
    const r = await admin
      .from("customer_equipment")
      .update({
        acquisition_type: input.acquisition_type,
        acquisition_amount_cents: input.acquisition_amount_cents,
        acquisition_started_at: input.acquisition_started_at,
      })
      .eq("id", input.equipment_id)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath(`/clientes/${row.customer_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Añade un equipo al inventario del cliente sin pasar por instalación.
 * Caso de uso: cliente tiene equipo de OTRA empresa ya instalado y
 * queremos registrarlo para poder ofrecerle contrato de mantenimiento.
 *
 * Acepta uno de los dos:
 *  - product_id (catálogo nuestro) → registra como equipo nuestro
 *  - external_brand + external_model → crea/reutiliza external_equipment_model
 *    y lo enlaza
 */
export async function addCustomerEquipmentAction(input: {
  customer_id: string;
  product_id?: string | null;
  external_brand?: string;
  external_model?: string;
  serial_number?: string | null;
  installed_at?: string | null;
  notes?: string | null;
  address_id?: string | null;
  /**
   * Fecha del último mantenimiento conocido. Si se informa, creamos
   * un `maintenance_jobs` retroactivo (status=completed, sin técnico)
   * para que el cron de programación calcule correctamente cuándo
   * toca el siguiente. Útil para equipos heredados a mitad de ciclo.
   */
  last_maintenance_at?: string | null;
  /**
   * Fecha en que queremos que se ejecute el PRÓXIMO mantenimiento.
   * Si se informa, creamos un `maintenance_jobs` scheduled para esa
   * fecha. Útil cuando el cliente nos contrata mid-cycle y queremos
   * fijar el inicio de los servicios.
   */
  next_maintenance_at?: string | null;
  /**
   * Periodicidad de mantenimiento en meses. Si se informa, en vez de crear un
   * solo job se genera la SERIE de visitas de los próximos 12 meses según la
   * periodicidad (igual que el motor de contratos). Vale para equipo propio y
   * de competencia.
   */
  maintenance_periodicity_months?: number | null;
  /** Modalidad heredada (importación): 'cash' venta | 'rental' alquiler | 'renting'. */
  acquisition_type?: "cash" | "rental" | "renting" | "installed" | null;
  /** Cuota €/mes (alquiler/renting) o precio venta, en céntimos. */
  acquisition_amount_cents?: number | null;
  /** Fecha de inicio del contrato heredado. */
  acquisition_started_at?: string | null;
  /**
   * Origen del alta (explícito). Solo "alta_manual" («Añadir equipo» de la
   * ficha) convierte la fecha en una tarea de llamada; "pack" e
   * "importacion" generan las visitas de siempre.
   */
  origen: OrigenAltaEquipo;
  /** Solo origen "pack": nº de extras, para el título de la llamada. */
  extras_en_pack?: number;
}): Promise<{ id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // SEGURIDAD: admin client salta RLS → verificar que el cliente es de tu
  // empresa antes de colgarle un equipo (si no, se inyectaría customer_id ajeno).
  const { data: ownerCust } = await admin
    .from("customers")
    .select("id")
    .eq("id", input.customer_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!ownerCust) throw new Error("Cliente no encontrado o no pertenece a tu empresa");

  const productId: string | null = input.product_id ?? null;
  let externalModelId: string | null = null;

  // Si NO viene product_id pero SÍ marca/modelo, lo registramos como
  // external_equipment_model (reutiliza si ya existe).
  if (!productId) {
    const brand = (input.external_brand ?? "").trim();
    const model = (input.external_model ?? "").trim();
    if (!brand || !model) {
      throw new Error("Indica producto del catálogo o marca+modelo del equipo externo");
    }
    const { data: existing } = await admin
      .from("external_equipment_models")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("brand", brand)
      .eq("model", model)
      .limit(1)
      .maybeSingle();
    if (existing) {
      externalModelId = (existing as { id: string }).id;
    } else {
      const { data: created, error } = await admin
        .from("external_equipment_models")
        .insert({
          company_id: session.company_id,
          brand,
          model,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      externalModelId = (created as { id: string }).id;
    }
  }

  const eqPayload: Record<string, unknown> = {
    company_id: session.company_id,
    customer_id: input.customer_id,
    product_id: productId,
    external_equipment_model_id: externalModelId,
    address_id: input.address_id ?? null,
    serial_number: input.serial_number ?? null,
    installed_at: input.installed_at ?? null,
    notes: input.notes ?? null,
    is_active: true,
    acquisition_type: input.acquisition_type ?? null,
    acquisition_amount_cents: input.acquisition_amount_cents ?? null,
    acquisition_started_at: input.acquisition_started_at ?? null,
  };
  let eqRes = await admin
    .from("customer_equipment")
    .insert(eqPayload)
    .select("id")
    .single();
  // Defensa: si las columnas de modalidad no están aún en el cache, reintentar
  // sin ellas (no bloquear el alta del equipo por la migración).
  if (eqRes.error && /acquisition_|schema cache|Could not find/i.test(eqRes.error.message ?? "")) {
    delete eqPayload.acquisition_type;
    delete eqPayload.acquisition_amount_cents;
    delete eqPayload.acquisition_started_at;
    eqRes = await admin.from("customer_equipment").insert(eqPayload).select("id").single();
  }
  if (eqRes.error) throw new Error(eqRes.error.message);

  const equipmentId = (eqRes.data as { id: string }).id;

  // Histórico: si el usuario sabe cuándo fue el último mantenimiento,
  // creamos un maintenance_jobs completado retroactivo. Así el cron y
  // los plans calculan correctamente cuándo toca el próximo.
  if (input.last_maintenance_at) {
    try {
      await admin.from("maintenance_jobs").insert({
        company_id: session.company_id,
        customer_id: input.customer_id,
        customer_equipment_id: equipmentId,
        kind: "contracted",
        status: "completed",
        completed_at: new Date(input.last_maintenance_at).toISOString(),
        notes:
          "Registro histórico introducido al añadir el equipo (anterior al CRM).",
      });
    } catch (e) {
      console.error("[addCustomerEquipment] last_maintenance insert failed:", e);
    }
  }

  // ¿El cliente tiene ya un contrato de mantenimiento ACTIVO que lo cubra?
  // Los contratos son por equipo (este acaba de nacer, no puede tener uno);
  // uno sin equipo cubre al cliente entero → comportamiento de siempre.
  let cubiertoPorContrato = false;
  if (input.origen !== "importacion") {
    const { count, error } = await admin
      .from("maintenance_contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("customer_id", input.customer_id)
      .is("customer_equipment_id", null)
      .eq("status", "active")
      .is("deleted_at", null);
    if (error) console.error("[addCustomerEquipment] contrato de mantenimiento:", error.message);
    else cubiertoPorContrato = (count ?? 0) > 0;
  }

  // SIN contrato de mantenimiento (Mario 2026-11-09): la fecha «próximo
  // mantenimiento» es para LLAMAR al cliente ese día y ofrecérselo. Se crea
  // UNA tarea de llamada en la agenda (kind 'call', asignada a quien da de
  // alta el equipo; sale en su agenda y en «Mi día» ese día). Ni visitas
  // contratadas ni serie: la periodicidad se aplica cuando acepte
  // «Proponer mantenimiento».
  let llamadaCreada = false;
  const periodicity = input.maintenance_periodicity_months ?? null;
  const modo = programacionMantenimiento(input.origen, cubiertoPorContrato);
  const dia = modo === "llamada" ? diaLlamada(input.next_maintenance_at) : null;
  if (dia) {
    let nombreEquipo = "Equipo";
    if (productId) {
      const { data: prod } = await admin
        .from("products")
        .select("name")
        .eq("id", productId)
        .maybeSingle();
      nombreEquipo = (prod as { name: string } | null)?.name ?? "Equipo";
    } else {
      nombreEquipo = `${(input.external_brand ?? "").trim()} ${(input.external_model ?? "").trim()}`.trim() || "Equipo externo";
    }
    const inicio = madridLocalToUtcISO(`${dia}T${HORA_LLAMADA}`);
    const { error: llErr } = await admin.from("agenda_events").insert({
      company_id: session.company_id,
      kind: "call",
      title: tituloLlamada(nombreEquipo, input.origen === "pack" ? input.extras_en_pack ?? 0 : 0),
      description: descripcionLlamada(periodicity),
      starts_at: inicio,
      ends_at: null,
      all_day: false,
      assigned_user_id: session.user_id,
      subject_type: "customer",
      subject_id: input.customer_id,
      is_outside_hours: false,
      created_by: session.user_id,
    });
    if (llErr) console.error("[addCustomerEquipment] tarea de llamada:", llErr.message);
    else llamadaCreada = true;
  }

  // CON contrato de mantenimiento activo del cliente → como siempre:
  //  - Si hay PERIODICIDAD → generar la SERIE de visitas de los próximos 12
  //    meses (igual que contratos). firstDue = próximo indicado, o si no se
  //    indica, instalación + periodicidad.
  //  - Si NO hay periodicidad pero sí "próximo" → un único job.
  if (modo === "visitas" && periodicity && periodicity > 0) {
    try {
      let firstDue: Date | null = null;
      if (input.next_maintenance_at) {
        firstDue = new Date(input.next_maintenance_at);
      } else if (input.installed_at) {
        const d = new Date(input.installed_at);
        d.setMonth(d.getMonth() + periodicity);
        firstDue = d;
      } else if (input.last_maintenance_at) {
        const d = new Date(input.last_maintenance_at);
        d.setMonth(d.getMonth() + periodicity);
        firstDue = d;
      }
      if (firstDue && !isNaN(firstDue.getTime())) {
        const { generateEquipmentMaintenanceWindow } = await import(
          "@/modules/maintenance/auto-schedule"
        );
        await generateEquipmentMaintenanceWindow({
          company_id: session.company_id,
          customer_id: input.customer_id,
          customer_equipment_id: equipmentId,
          periodicity_months: periodicity,
          firstDue,
          monthsAhead: 12,
        });
      }
    } catch (e) {
      console.error("[addCustomerEquipment] generar serie mantenimientos:", e);
    }
  } else if (modo === "visitas" && input.next_maintenance_at) {
    try {
      await admin.from("maintenance_jobs").insert({
        company_id: session.company_id,
        customer_id: input.customer_id,
        customer_equipment_id: equipmentId,
        kind: "contracted",
        status: "scheduled",
        scheduled_at: new Date(input.next_maintenance_at).toISOString(),
        notes: "Programado al registrar el equipo.",
      });
    } catch (e) {
      console.error("[addCustomerEquipment] next_maintenance insert failed:", e);
    }
  }

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: input.customer_id,
    kind: "customer.equipment_added",
    payload: {
      product_id: productId,
      external_model_id: externalModelId,
      installed_by_other: !productId,
      had_last_maintenance: !!input.last_maintenance_at,
      had_next_maintenance: !!input.next_maintenance_at,
      llamada_ofrecer_mantenimiento: llamadaCreada ? dia : null,
      periodicidad_meses: periodicity,
      cubierto_por_contrato_mantenimiento: cubiertoPorContrato,
      origen: input.origen,
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${input.customer_id}`);
  return { id: equipmentId };
}

/**
 * Da de baja un equipo del cliente (is_active=false). Pensado sobre todo para
 * equipos EXTERNOS (no nuestros): el cliente se queda la máquina y nosotros solo
 * quitamos nuestro registro — NO pasa por almacén/stock (no es nuestro). Al
 * darlo de baja, cancelamos sus mantenimientos futuros (deja de tener
 * mantenimiento con nosotros). Soft-delete: queda en histórico con badge "Baja".
 * Solo admin / director técnico o comercial.
 */
export async function removeCustomerEquipmentAction(
  equipmentId: string,
  customerId: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director");
  if (!isUpper) throw new Error("Solo admin o director puede dar de baja equipos");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtrar por company_id.
  const r = await admin
    .from("customer_equipment")
    .update({ is_active: false })
    .eq("id", equipmentId)
    .eq("company_id", session.company_id)
    .select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Equipo no encontrado o no pertenece a tu empresa");

  // Cancelar mantenimientos futuros de este equipo (ya no toca: se da de baja).
  // Defensivo: si falla, no abortamos la baja del equipo.
  try {
    await admin
      .from("maintenance_jobs")
      .update({ status: "cancelled" })
      .eq("company_id", session.company_id)
      .eq("customer_equipment_id", equipmentId)
      .in("status", ["scheduled", "preprogrammed"]);
  } catch (e) {
    console.error("[removeCustomerEquipment] cancelar mantenimientos futuros:", e);
  }

  // Pack: si este equipo es un PRINCIPAL, dar de baja también sus EXTRAS (van
  // físicamente con él) y cancelar sus mantenimientos. Defensivo: si la columna
  // parent_equipment_id no existe todavía, no rompe la baja del principal.
  try {
    const { data: kids } = await admin
      .from("customer_equipment")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("parent_equipment_id", equipmentId)
      .eq("is_active", true);
    const kidIds = ((kids ?? []) as Array<{ id: string }>).map((k) => k.id);
    if (kidIds.length > 0) {
      await admin
        .from("customer_equipment")
        .update({ is_active: false })
        .in("id", kidIds)
        .eq("company_id", session.company_id);
      await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled" })
        .eq("company_id", session.company_id)
        .in("customer_equipment_id", kidIds)
        .in("status", ["scheduled", "preprogrammed"]);
    }
  } catch (e) {
    console.error("[removeCustomerEquipment] cascada extras:", e);
  }

  try {
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: customerId,
      kind: "customer.equipment_removed",
      payload: { equipment_id: equipmentId },
      actor_user_id: session.user_id,
    });
  } catch {
    /* no-op */
  }

  revalidatePath(`/clientes/${customerId}`);
}

export async function addCustomerEquipmentSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Única entrada desde el navegador: el botón «Añadir equipo» de la ficha.
    // El origen se fija aquí, no se acepta del cliente.
    await addCustomerEquipmentAction({
      ...(input as Omit<Parameters<typeof addCustomerEquipmentAction>[0], "origen">),
      origen: "alta_manual",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function removeCustomerEquipmentSafeAction(
  equipmentId: string,
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await removeCustomerEquipmentAction(equipmentId, customerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
