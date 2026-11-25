"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { addCustomerEquipmentAction } from "./equipment-actions";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { parteConMantenimiento } from "@/shared/lib/packs/complemento";

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
  /**
   * Equipo complementario (plan Horeca, Mario 2026-11-25): la ósmosis/UF de
   * un Horeca o el Horeca de una ósmosis. Se enlaza con pack_role
   * 'complemento'. Si el principal es un Horeca, las fechas y la periodicidad
   * de mantenimiento pasan al complemento (el Horeca no tiene mantenimiento).
   */
  complementos?: EquipmentLineInput[];
}): Promise<
  | { ok: true; mainId: string; extraIds: string[]; complementoIds: string[] }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    const lineaValida = (x: EquipmentLineInput) =>
      !!x.product_id || !!(x.external_brand?.trim() && x.external_model?.trim());
    const complementos = (input.complementos ?? []).filter(lineaValida);

    // ¿Quién lleva el mantenimiento? Si el principal es un Horeca, su ósmosis/UF.
    let mainLine: EquipmentLineInput = input.main;
    if (complementos.length > 0 && input.main.product_id) {
      let tipoPrincipal: string | null = null;
      try {
        const { cargarCatalogoModelo } = await import("@/modules/equipos-modelo/datos");
        const { tipoEfectivoProducto } = await import("@/modules/equipos-modelo/logica");
        tipoPrincipal = tipoEfectivoProducto(
          input.main.product_id,
          await cargarCatalogoModelo(session.company_id),
        );
      } catch (e) {
        console.error("[addCustomerEquipmentPack] tipo del principal:", e);
      }
      if (parteConMantenimiento(tipoPrincipal, true) === "complemento") {
        const [primero, ...resto] = complementos;
        complementos.splice(0, complementos.length, {
          ...primero!,
          last_maintenance_at: primero!.last_maintenance_at ?? input.main.last_maintenance_at ?? null,
          next_maintenance_at: primero!.next_maintenance_at ?? input.main.next_maintenance_at ?? null,
          maintenance_periodicity_months:
            primero!.maintenance_periodicity_months ?? input.main.maintenance_periodicity_months ?? null,
        }, ...resto);
        // El Horeca conserva la fecha solo para la llamada de «ofrecer
        // mantenimiento» (una por pack); el histórico y las visitas van a la
        // ósmosis/UF (addCustomerEquipmentAction no programa visitas a un Horeca).
        mainLine = { ...input.main, last_maintenance_at: null };
      }
    }

    // 1) Equipo principal (usa toda la lógica existente).
    const main = await addCustomerEquipmentAction({
      customer_id: input.customer_id,
      address_id: input.address_id ?? null,
      ...mainLine,
      // La llamada (si hay fecha y no hay contrato) es UNA para todo el pack.
      origen: "pack",
      extras_en_pack: input.extras.filter(lineaValida).length + complementos.length,
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
        origen: "pack_extra",
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

    // 3) Complementos: igual que un extra, con pack_role = 'complemento'. Si el
    //    principal era el Horeca, el complemento lleva las fechas de
    //    mantenimiento; como su alta es «pack_extra», no crea otra llamada.
    const complementoIds: string[] = [];
    for (const comp of complementos) {
      const created = await addCustomerEquipmentAction({
        customer_id: input.customer_id,
        address_id: input.address_id ?? null,
        ...comp,
        origen: "pack_extra",
      });
      complementoIds.push(created.id);
      let upd = await admin
        .from("customer_equipment")
        .update({ parent_equipment_id: mainId, pack_role: "complemento" })
        .eq("id", created.id)
        .eq("company_id", session.company_id);
      // Sin la columna pack_role (migración sin aplicar): queda como extra.
      if (upd.error && /pack_role/i.test(upd.error.message ?? "")) {
        upd = await admin
          .from("customer_equipment")
          .update({ parent_equipment_id: mainId })
          .eq("id", created.id)
          .eq("company_id", session.company_id);
      }
      if (upd.error && !/parent_equipment_id|schema cache|Could not find/i.test(upd.error.message ?? "")) {
        console.error("[addCustomerEquipmentPack] link complemento failed:", upd.error.message);
      }
    }

    revalidatePath(`/clientes/${input.customer_id}`);
    return { ok: true, mainId, extraIds, complementoIds };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
