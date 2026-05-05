"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface CustomerEquipmentRow {
  id: string;
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
}

export async function listCustomerEquipment(customerId: string): Promise<CustomerEquipmentRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: equipment } = await supabase
    .from("customer_equipment")
    .select(
      `
        id,
        serial_number,
        installed_at,
        warranty_until,
        is_active,
        notes,
        installation_id,
        product:products(name),
        external:external_equipment_models(name),
        address:addresses(line1, city)
      `,
    )
    .eq("customer_id", customerId)
    .order("installed_at", { ascending: false });

  const rows = (equipment ?? []) as Array<{
    id: string;
    serial_number: string | null;
    installed_at: string | null;
    warranty_until: string | null;
    is_active: boolean;
    notes: string | null;
    installation_id: string | null;
    product: { name: string } | null;
    external: { name: string } | null;
    address: { line1: string; city: string | null } | null;
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

  return rows.map((r) => ({
    id: r.id,
    serial_number: r.serial_number,
    installed_at: r.installed_at,
    warranty_until: r.warranty_until,
    is_active: r.is_active,
    notes: r.notes,
    installation_id: r.installation_id,
    product_name: r.product?.name ?? null,
    external_model_name: r.external?.name ?? null,
    address_label: r.address ? `${r.address.line1}${r.address.city ? `, ${r.address.city}` : ""}` : null,
    last_maintenance_at: lastMaintenance[r.id] ?? null,
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
}): Promise<{ id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

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

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: input.customer_id,
    kind: "customer.equipment_added",
    payload: {
      product_id: productId,
      external_model_id: externalModelId,
      installed_by_other: !productId,
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${input.customer_id}`);
  return { id: (row as { id: string }).id };
}

export async function removeCustomerEquipmentAction(
  equipmentId: string,
  customerId: string,
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("customer_equipment")
    .update({ is_active: false })
    .eq("id", equipmentId);
  if (r.error) throw new Error(r.error.message);
  revalidatePath(`/clientes/${customerId}`);
}
