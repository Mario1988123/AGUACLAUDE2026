"use server";

import { createClient } from "@/shared/lib/supabase/server";
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
