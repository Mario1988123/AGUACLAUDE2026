"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Exporta TODOS los datos personales de un cliente (RGPD art. 15 derecho
 * de acceso). Devuelve un JSON con: ficha cliente, direcciones, cuentas
 * bancarias, contratos, instalaciones, mantenimientos, propuestas,
 * incidencias, eventos timeline, consentimientos.
 *
 * Restringido a admin de empresa o superadmin (datos sensibles).
 */
export async function exportCustomerDataAction(
  customerId: string,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin de empresa puede exportar datos RGPD" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: customer } = await admin
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Cliente no encontrado" };

    const [
      addresses,
      banks,
      contracts,
      installations,
      maintenance,
      proposals,
      incidents,
      events,
      consents,
    ] = await Promise.all([
      admin.from("addresses").select("*").eq("customer_id", customerId),
      admin.from("customer_bank_accounts").select("*").eq("customer_id", customerId),
      admin.from("contracts").select("*").eq("customer_id", customerId),
      admin.from("installations").select("*").eq("customer_id", customerId),
      admin.from("maintenance_jobs").select("*").eq("customer_id", customerId),
      admin.from("proposals").select("*").eq("customer_id", customerId),
      admin.from("incidents").select("*").eq("customer_id", customerId),
      admin
        .from("events")
        .select("*")
        .eq("subject_type", "customer")
        .eq("subject_id", customerId)
        .order("created_at", { ascending: false }),
      admin.from("customer_consents").select("*").eq("customer_id", customerId),
    ]);

    // Registrar el export como evento (auditoría)
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: customerId,
      kind: "customer.rgpd_export",
      payload: { reason: "RGPD art. 15 — derecho de acceso" },
      actor_user_id: session.user_id,
    });

    return {
      ok: true,
      payload: {
        exported_at: new Date().toISOString(),
        exported_by: session.user_id,
        customer,
        addresses: addresses.data ?? [],
        bank_accounts: banks.data ?? [],
        contracts: contracts.data ?? [],
        installations: installations.data ?? [],
        maintenance_jobs: maintenance.data ?? [],
        proposals: proposals.data ?? [],
        incidents: incidents.data ?? [],
        events: events.data ?? [],
        consents: consents.data ?? [],
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Solicita borrado de cliente (RGPD art. 17 derecho al olvido).
 *
 * Por seguridad NO borra físicamente — hace soft-delete + anonimiza
 * campos PII (nombre, email, teléfono, DNI). Conserva referencias
 * estructurales (contratos, facturas) por obligaciones fiscales (la
 * AEAT exige conservar facturación 6 años). Los datos personales sí
 * se anonimizan.
 *
 * Solo admin de empresa o superadmin.
 */
export async function requestCustomerDeletionAction(input: {
  customer_id: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin puede solicitar borrado RGPD" };
    }
    if (!input.reason.trim()) return { ok: false, error: "Motivo obligatorio" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Anonimizar PII manteniendo estructura.
    const r = await admin
      .from("customers")
      .update({
        first_name: "[BORRADO]",
        last_name: null,
        legal_name: "[BORRADO]",
        trade_name: null,
        email: null,
        phone_primary: null,
        phone_secondary: null,
        tax_id: null,
        notes: null,
        deleted_at: new Date().toISOString(),
        deleted_reason: `RGPD art. 17: ${input.reason}`,
      })
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id);
    if (r.error) {
      // Defensivo: deleted_reason puede no existir
      if (/deleted_reason|column .* does not exist/i.test(r.error.message ?? "")) {
        const retry = await admin
          .from("customers")
          .update({
            first_name: "[BORRADO]",
            last_name: null,
            legal_name: "[BORRADO]",
            trade_name: null,
            email: null,
            phone_primary: null,
            phone_secondary: null,
            tax_id: null,
            notes: null,
            deleted_at: new Date().toISOString(),
          })
          .eq("id", input.customer_id)
          .eq("company_id", session.company_id);
        if (retry.error) return { ok: false, error: retry.error.message };
      } else {
        return { ok: false, error: r.error.message };
      }
    }

    // Anonimizar direcciones también
    try {
      await admin
        .from("addresses")
        .update({
          street_type: null,
          street: "[BORRADO]",
          street_number: null,
          notes: null,
        })
        .eq("customer_id", input.customer_id);
    } catch {
      /* */
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: input.customer_id,
      kind: "customer.rgpd_delete",
      payload: { reason: input.reason },
      actor_user_id: session.user_id,
    });

    revalidatePath("/clientes");
    revalidatePath(`/clientes/${input.customer_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
