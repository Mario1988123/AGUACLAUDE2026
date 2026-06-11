"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

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
}

export async function listCustomerEquipment(customerId: string): Promise<CustomerEquipmentRow[]> {
  await requireSession();
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
  const { data: equipment, error } = await supabase
    .from("customer_equipment")
    .select(
      `
        id,
        customer_id,
        product_id,
        address_id,
        serial_number,
        installed_at,
        warranty_until,
        is_active,
        notes,
        installation_id,
        product:products(name),
        external:external_equipment_models(brand, model),
        address:addresses(street_type, street, street_number, city)
      `,
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
    address_id: string | null;
    serial_number: string | null;
    installed_at: string | null;
    warranty_until: string | null;
    is_active: boolean;
    notes: string | null;
    installation_id: string | null;
    product: { name: string } | null;
    external: { brand: string | null; model: string | null } | null;
    address: {
      street_type: string | null;
      street: string | null;
      street_number: string | null;
      city: string | null;
    } | null;
  }>;

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: maintenance } = await supabase
    .from("maintenance_jobs")
    .select("customer_equipment_id, completed_at")
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
  const { data: upcoming } = await supabase
    .from("maintenance_jobs")
    .select("customer_equipment_id, scheduled_at")
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
    product_name: r.product?.name ?? null,
    external_model_name:
      r.external?.brand && r.external?.model
        ? `${r.external.brand} ${r.external.model}`
        : null,
    address_label: r.address
      ? [
          r.address.street_type,
          r.address.street,
          r.address.street_number,
          r.address.city,
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/^([a-zñA-ZÑ]+) /, (m) => m.charAt(0).toUpperCase() + m.slice(1))
      : null,
    last_maintenance_at: lastMaintenance[r.id] ?? null,
    next_maintenance_at: nextMaintenance[r.id] ?? null,
  }));
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

  const { data: row, error } = await admin
    .from("customer_equipment")
    .insert({
      company_id: session.company_id,
      customer_id: input.customer_id,
      product_id: productId,
      external_equipment_model_id: externalModelId,
      address_id: input.address_id ?? null,
      serial_number: input.serial_number ?? null,
      installed_at: input.installed_at ?? null,
      notes: input.notes ?? null,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const equipmentId = (row as { id: string }).id;

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

  // Programar el próximo: si el usuario quiere fijar la siguiente
  // visita (típico cuando contratamos a mitad de ciclo), creamos un
  // job scheduled con esa fecha. El técnico se asigna después.
  if (input.next_maintenance_at) {
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
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${input.customer_id}`);
  return { id: equipmentId };
}

export async function removeCustomerEquipmentAction(
  equipmentId: string,
  customerId: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
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
  revalidatePath(`/clientes/${customerId}`);
}

export async function addCustomerEquipmentSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await addCustomerEquipmentAction(input as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
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
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
