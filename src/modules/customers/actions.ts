"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { customerCreateSchema } from "./schemas";
import type { CustomerDetail, CustomerListItem } from "./types";

export async function listCustomers(q?: string): Promise<CustomerListItem[]> {
  await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, is_active, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
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

  // Si viene de lead, marcar el lead como convertido + migrar direcciones
  if (parsed.source_lead_id) {
    await supabase
      .from("leads")
      .update({
        status: "converted",
        converted_at: new Date().toISOString(),
        converted_to_customer_id: newId,
      } as never)
      .eq("id", parsed.source_lead_id);
    // Mover direcciones del lead al customer (función helper en BD)
    await supabase.rpc("promote_lead_to_customer" as never, {
      p_lead_id: parsed.source_lead_id,
      p_customer_id: newId,
    } as never);
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
