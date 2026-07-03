"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { addCustomerEquipmentAction } from "./equipment-actions";

/**
 * Una línea de equipo dentro de un pack (principal o extra). Mismos campos que
 * addCustomerEquipmentAction para un equipo suelto.
 */
export interface EquipmentLineInput {
  product_id?: string | null;
  external_brand?: string;
  external_model?: string;
  serial_number?: string | null;
  installed_at?: string | null;
  notes?: string | null;
  last_maintenance_at?: string | null;
  next_maintenance_at?: string | null;
  maintenance_periodicity_months?: number | null;
  acquisition_type?: "cash" | "rental" | "renting" | null;
  acquisition_amount_cents?: number | null;
  acquisition_started_at?: string | null;
}

/**
 * Añade un PACK documental al cliente: 1 equipo PRINCIPAL + N EXTRAS, enlazando
 * cada extra al principal vía customer_equipment.parent_equipment_id.
 *
 * DOCUMENTAL = registrar lo que el cliente ya tiene (o venta sin instalación por
 * el motor). NO mueve stock — igual que el alta de equipo suelto de hoy. Para la
 * venta-a-instalar con stock se usa el flujo de propuesta/contrato/instalación.
 *
 * Reutiliza addCustomerEquipmentAction para cada línea (resuelve producto/externo,
 * crea mantenimientos, evento) y solo añade el vínculo padre-hijo con un UPDATE
 * posterior (defensivo: si la columna parent_equipment_id aún no existe porque la
 * migración no se aplicó, no rompe el alta; el pack queda como equipos sueltos).
 */
export async function addCustomerEquipmentPackAction(input: {
  customer_id: string;
  address_id?: string | null;
  main: EquipmentLineInput;
  extras: EquipmentLineInput[];
}): Promise<{ ok: true; mainId: string; extraIds: string[] } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    // 1) Equipo principal (usa toda la lógica existente).
    const main = await addCustomerEquipmentAction({
      customer_id: input.customer_id,
      address_id: input.address_id ?? null,
      ...input.main,
    });
    const mainId = main.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const extraIds: string[] = [];

    // 2) Extras: se crean igual y luego se enlazan al principal.
    for (const extra of input.extras) {
      // Saltar líneas vacías (sin producto ni marca/modelo).
      const hasProduct = !!extra.product_id;
      const hasExternal = !!(extra.external_brand?.trim() && extra.external_model?.trim());
      if (!hasProduct && !hasExternal) continue;

      const created = await addCustomerEquipmentAction({
        customer_id: input.customer_id,
        address_id: input.address_id ?? null,
        ...extra,
      });
      extraIds.push(created.id);

      // Vínculo padre-hijo (defensivo: no romper si la columna no existe todavía).
      const upd = await admin
        .from("customer_equipment")
        .update({ parent_equipment_id: mainId })
        .eq("id", created.id)
        .eq("company_id", session.company_id);
      if (upd.error && !/parent_equipment_id|schema cache|Could not find/i.test(upd.error.message ?? "")) {
        console.error("[addCustomerEquipmentPack] link extra failed:", upd.error.message);
      }
    }

    revalidatePath(`/clientes/${input.customer_id}`);
    return { ok: true, mainId, extraIds };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
