"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { madridLocalToUtcISO } from "@/shared/lib/format-date";

/**
 * Crea una orden de reubicación de un equipo del cliente.
 *
 * - Genera installation kind='relocation', status='unscheduled' enlazada
 *   a la nueva dirección. El director técnico la agendará desde
 *   /instalaciones/[id] como cualquier otra.
 * - Si fee_cents > 0, crea wallet_entry pendiente para que el cobro
 *   quede pendiente al cliente (cobrable por el técnico al ir).
 * - El cambio efectivo de address_id en customer_equipment se hace
 *   cuando la instalación se complete (lo gestiona el flujo normal de
 *   cierre de instalación).
 */
export async function relocateEquipmentAction(input: {
  customer_equipment_id: string;
  new_address_id: string;
  scheduled_at?: string | null;
  fee_cents?: number | null;
  fee_method?: "cash" | "card" | "transfer" | "domiciliation" | null;
  notes?: string | null;
}): Promise<
  { ok: true; installation_id: string } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("technical_director") &&
      !session.roles.includes("commercial_director")
    ) {
      return { ok: false, error: "Solo admin/dirección puede reubicar" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Cargar equipo + validar empresa
    const { data: equipment } = await admin
      .from("customer_equipment")
      .select(
        "id, company_id, customer_id, product_id, address_id, serial_number, product:products(name)",
      )
      .eq("id", input.customer_equipment_id)
      .maybeSingle();
    if (!equipment) return { ok: false, error: "Equipo no encontrado" };
    const eq = equipment as {
      id: string;
      company_id: string;
      customer_id: string;
      product_id: string | null;
      address_id: string | null;
      serial_number: string | null;
      product: { name: string } | null;
    };
    if (eq.company_id !== session.company_id) {
      return { ok: false, error: "Otra empresa" };
    }
    if (eq.address_id === input.new_address_id) {
      return {
        ok: false,
        error: "La nueva dirección es la misma que la actual",
      };
    }

    // 1bis) Validar que la nueva dirección es de MI empresa y del MISMO cliente
    // (anti cross-tenant: el address_id viene del navegador).
    const { data: newAddr } = await admin
      .from("addresses")
      .select("id, company_id, customer_id")
      .eq("id", input.new_address_id)
      .maybeSingle();
    const na = newAddr as { company_id: string; customer_id: string | null } | null;
    if (!na || na.company_id !== session.company_id) {
      return { ok: false, error: "Dirección no encontrada" };
    }
    if (na.customer_id && na.customer_id !== eq.customer_id) {
      return { ok: false, error: "La dirección pertenece a otro cliente" };
    }

    // 2) Reference code I-YYYY-NNNN
    const year = new Date().getFullYear();
    const yearPrefix = `I-${year}-`;
    const { data: lastCoded } = await admin
      .from("installations")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${yearPrefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
    if (lastCode) {
      const m = lastCode.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }
    const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

    const productName = eq.product?.name ?? "Equipo";
    const noteParts = [
      `Reubicación: ${productName}` + (eq.serial_number ? ` S/N ${eq.serial_number}` : ""),
      `customer_equipment_id=${eq.id}`,
      input.notes ?? "",
    ].filter(Boolean);

    const status = input.scheduled_at ? "scheduled" : "unscheduled";

    // 3) Insertar installation
    const { data: inst, error: instErr } = await admin
      .from("installations")
      .insert({
        company_id: session.company_id,
        kind: "relocation",
        status,
        reference_code: referenceCode,
        customer_id: eq.customer_id,
        address_id: input.new_address_id,
        scheduled_at: input.scheduled_at ? madridLocalToUtcISO(input.scheduled_at) : null,
        notes: noteParts.join(" · "),
      })
      .select("id")
      .single();
    if (instErr) return { ok: false, error: instErr.message };
    const installationId = (inst as { id: string }).id;

    // 4) installation_items con el producto a reubicar (1 unidad)
    if (eq.product_id) {
      try {
        await admin.from("installation_items").insert({
          installation_id: installationId,
          company_id: session.company_id,
          product_id: eq.product_id,
          quantity: 1,
          serial_number: eq.serial_number,
          notes: `Reubicación: ${productName}`,
        });
      } catch (e) {
        console.error("[relocate] installation_items insert:", e);
      }
    }

    // 5) Si hay coste, crear wallet entry pendiente
    if (input.fee_cents && input.fee_cents > 0) {
      try {
        await admin.from("wallet_entries").insert({
          company_id: session.company_id,
          customer_id: eq.customer_id,
          installation_id: installationId,
          concept: `Reubicación equipo (${productName})`,
          amount_cents: input.fee_cents,
          method: input.fee_method ?? "cash",
          status: "pending",
        });
      } catch (e) {
        console.error("[relocate] wallet_entries insert:", e);
      }
    }

    // 6) Evento timeline
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "customer",
        subject_id: eq.customer_id,
        kind: "equipment.relocation_requested",
        payload: {
          customer_equipment_id: eq.id,
          installation_id: installationId,
          old_address_id: eq.address_id,
          new_address_id: input.new_address_id,
          fee_cents: input.fee_cents ?? 0,
        },
        actor_user_id: session.user_id,
      });
    } catch {
      /* fail-soft */
    }

    revalidatePath(`/clientes/${eq.customer_id}`);
    revalidatePath("/instalaciones");
    return { ok: true, installation_id: installationId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
