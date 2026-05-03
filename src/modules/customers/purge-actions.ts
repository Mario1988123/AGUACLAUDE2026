"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

/**
 * Borrado físico definitivo de un cliente. Sólo permitido si el cliente
 * está soft-deleted desde hace al menos 30 días. Borra en cascada lo
 * configurado en BD (FKs on delete cascade) y deja un evento de auditoría.
 */
export async function purgeCustomerAction(customerId: string): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: c } = await admin
    .from("customers")
    .select("id, company_id, deleted_at")
    .eq("id", customerId)
    .maybeSingle();
  const row = c as { id: string; company_id: string; deleted_at: string | null } | null;
  if (!row) throw new Error("Cliente no encontrado");
  if (row.company_id !== session.company_id) throw new Error("Otra empresa");
  if (!row.deleted_at) throw new Error("El cliente no está marcado como eliminado");
  const ageDays = (Date.now() - new Date(row.deleted_at).getTime()) / 86400000;
  if (ageDays < 30) throw new Error(`Aún quedan ${Math.ceil(30 - ageDays)} días para el borrado físico`);

  // Auditoría antes (después del DELETE no podríamos referenciar el id)
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: customerId,
    kind: "customer.purged",
    payload: { soft_deleted_at: row.deleted_at },
    actor_user_id: session.user_id,
  });

  await admin.from("customers").delete().eq("id", customerId);
  revalidatePath("/clientes");
}

/**
 * Anonimiza un cliente: borra datos personales identificables conservando
 * el id, fechas e importes para que las estadísticas históricas sigan
 * cuadrando. Útil para cumplir con derecho al olvido (RGPD art. 17) sin
 * romper agregados.
 */
export async function anonymizeCustomerAction(customerId: string): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const tag = `[ANON-${customerId.slice(0, 8)}]`;
  await admin
    .from("customers")
    .update({
      legal_name: tag,
      trade_name: null,
      first_name: tag,
      last_name: null,
      email: null,
      phone_primary: null,
      phone_secondary: null,
      tax_id: null,
      notes: "Anonimizado por solicitud RGPD",
      is_active: false,
    })
    .eq("id", customerId)
    .eq("company_id", session.company_id);

  // Borrar direcciones (datos personales)
  await admin
    .from("addresses")
    .delete()
    .eq("company_id", session.company_id)
    .eq("customer_id", customerId);

  // Anonimizar snapshots en contratos
  await admin
    .from("contracts")
    .update({
      customer_snapshot: { anonymized: true },
      bank_account_snapshot: null,
    })
    .eq("customer_id", customerId)
    .eq("company_id", session.company_id);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: customerId,
    kind: "customer.anonymized",
    payload: { reason: "rgpd_right_to_be_forgotten" },
    actor_user_id: session.user_id,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
}
