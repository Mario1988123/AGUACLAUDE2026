"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { customerCreateSchema } from "./schemas";
import type { CustomerDetail, CustomerListItem } from "./types";
import { checkDedupe } from "@/shared/lib/dedupe/check-dedupe";

export async function listCustomers(
  q?: string,
  scope?: "mine" | "all",
): Promise<CustomerListItem[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const isUpperLevel =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director") ||
    session.roles.includes("technical_director");
  const effective = !isUpperLevel ? "mine" : (scope ?? "all");

  let query = supabase
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, is_active, created_at, assigned_user_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (effective === "mine") {
    query = query.eq("assigned_user_id", session.user_id);
  }
  if (q) {
    const c = q.replace(/[%_]/g, "");
    query = query.or(
      `legal_name.ilike.%${c}%,trade_name.ilike.%${c}%,first_name.ilike.%${c}%,last_name.ilike.%${c}%,email.ilike.%${c}%,phone_primary.ilike.%${c}%`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as Array<{
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    is_active: boolean;
    created_at: string;
  }>).map((c) => ({
    id: c.id,
    party_kind: c.party_kind,
    display_name:
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "Sin nombre"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
    email: c.email,
    phone_primary: c.phone_primary,
    is_active: c.is_active,
    created_at: c.created_at,
  }));
}

export async function getCustomer(id: string): Promise<CustomerDetail> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as CustomerDetail;
}

export async function createCustomerAction(formData: FormData) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const raw = Object.fromEntries(formData.entries());
  const parsed = customerCreateSchema.parse(raw);

  // Anti-duplicado server-side. Si viene de lead, excluimos al propio lead
  // (porque sus datos siguen ahí hasta que actualizamos su estado).
  const dups = await checkDedupe({
    tax_id: parsed.tax_id || undefined,
    email: parsed.email || undefined,
    phone: parsed.phone_primary || undefined,
    exclude: parsed.source_lead_id
      ? { entity: "lead", id: parsed.source_lead_id }
      : undefined,
  });
  if (dups.length > 0) {
    const first = dups[0]!;
    const fieldLabel =
      first.field === "tax_id" ? "DNI/CIF" : first.field === "email" ? "email" : "teléfono";
    throw new Error(
      `Duplicado: ${fieldLabel} ya registrado en ${first.entity === "lead" ? "lead" : "cliente"} "${first.display_name}"${first.assigned_user_name ? ` (asignado a ${first.assigned_user_name})` : ""}`,
    );
  }

  const supabase = await createClient();
  const isLevel3 = session.roles.includes("sales_rep");
  const insertPayload = {
    company_id: session.company_id,
    party_kind: parsed.party_kind,
    legal_name: parsed.legal_name || null,
    trade_name: parsed.trade_name || null,
    first_name: parsed.first_name || null,
    last_name: parsed.last_name || null,
    email: parsed.email || null,
    phone_primary: parsed.phone_primary || null,
    phone_secondary: parsed.phone_secondary || null,
    tax_id: parsed.tax_id || null,
    notes: parsed.notes || null,
    source_lead_id: parsed.source_lead_id || null,
    assigned_user_id: isLevel3 ? session.user_id : null,
    assigned_at: isLevel3 ? new Date().toISOString() : null,
    created_by: session.user_id,
  };
  const { data, error } = await supabase
    .from("customers")
    .insert(insertPayload as never)
    .select("id")
    .single();
  if (error) throw error;
  const newId = (data as { id: string }).id;

  // Si viene de lead, marcar el lead como convertido + migrar direcciones.
  // Admin client para el UPDATE leads: la policy leads_update_by_scope
  // puede dejar fuera al usuario actual y ya nos ha mordido en
  // convertLeadToCustomerAction.
  if (parsed.source_lead_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin
      .from("leads")
      .update({
        status: "converted",
        converted_at: new Date().toISOString(),
        converted_to_customer_id: newId,
      })
      .eq("id", parsed.source_lead_id);
    // Mover direcciones del lead al customer (UPDATE directo con admin —
    // el RPC vive en schema `app` y no siempre es accesible vía REST).
    await admin
      .from("addresses")
      .update({ customer_id: newId, lead_id: null })
      .eq("lead_id", parsed.source_lead_id)
      .is("deleted_at", null);
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: newId,
    kind: "customer.created",
    payload: { from_lead: parsed.source_lead_id ?? null },
    actor_user_id: session.user_id,
  } as never);

  revalidatePath("/clientes");
  redirect(`/clientes/${newId}` as never);
}

/**
 * Registra contacto (call/whatsapp/email) en agenda + timeline para un cliente.
 */
export async function logCustomerContactAction(
  customerId: string,
  channel: "call" | "whatsapp" | "email",
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date().toISOString();

  const titleMap = {
    call: "Llamada",
    whatsapp: "WhatsApp",
    email: "Email",
  } as const;

  await supabase.from("agenda_events").insert({
    company_id: session.company_id,
    kind: channel === "call" ? "call" : "manual",
    status: "completed",
    title: `${titleMap[channel]} a cliente`,
    starts_at: now,
    assigned_user_id: session.user_id,
    subject_type: "customer",
    subject_id: customerId,
    created_by: session.user_id,
  });

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: customerId,
    kind: "customer.contacted",
    payload: { channel },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${customerId}`);
}

/**
 * Lista instalaciones de un cliente concreto (para bloque en ficha cliente).
 */
export async function listInstallationsByCustomer(customerId: string): Promise<
  Array<{
    id: string;
    reference_code: string | null;
    status: string;
    kind: string;
    scheduled_at: string | null;
    completed_at: string | null;
  }>
> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installations")
    .select("id, reference_code, status, kind, scheduled_at, completed_at")
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: false });
  return (data ?? []) as never;
}

/**
 * Lista contratos de un cliente concreto (para bloque en ficha cliente).
 */
export async function listContractsByCustomer(customerId: string): Promise<
  Array<{
    id: string;
    reference_code: string | null;
    status: string;
    plan_type: string;
    total_cash_cents: number | null;
    monthly_cents: number | null;
    signed_at: string | null;
    created_at: string;
  }>
> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("contracts")
    .select(
      "id, reference_code, status, plan_type, total_cash_cents, monthly_cents, signed_at, created_at",
    )
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as never;
}
