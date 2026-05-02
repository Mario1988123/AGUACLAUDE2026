"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { leadCreateSchema } from "./schemas";
import type { LeadDetail, LeadListItem, LeadStatus } from "./types";
import { notifyLeadCreated } from "@/modules/notifications/notifier";

export async function listLeads(filters?: {
  status?: LeadStatus;
  q?: string;
}): Promise<LeadListItem[]> {
  await requireSession();
  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, status, origin, potential, assigned_user_id, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.q) {
    const q = filters.q.replace(/[%_]/g, "");
    query = query.or(
      `legal_name.ilike.%${q}%,trade_name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone_primary.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    status: LeadStatus;
    origin: LeadListItem["origin"];
    potential: LeadListItem["potential"];
    assigned_user_id: string | null;
    created_at: string;
  }>;

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    party_kind: r.party_kind,
    display_name:
      r.party_kind === "company"
        ? r.trade_name || r.legal_name || "Sin nombre"
        : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Sin nombre",
    email: r.email,
    phone_primary: r.phone_primary,
    status: r.status,
    origin: r.origin,
    potential: r.potential,
    assigned_user_id: r.assigned_user_id,
    created_at: r.created_at,
    days_since_created: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
  }));
}

export async function getLead(id: string): Promise<LeadDetail> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as LeadDetail;
}

export async function createLeadAction(formData: FormData) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");

  const raw = Object.fromEntries(formData.entries());
  const parsed = leadCreateSchema.parse(raw);

  const supabase = await createClient();
  const isLevel3 = session.roles.includes("sales_rep") || session.roles.includes("telemarketer");
  const insertPayload = {
    company_id: session.company_id,
    party_kind: parsed.party_kind,
    legal_name: parsed.legal_name || null,
    trade_name: parsed.trade_name || null,
    first_name: parsed.first_name || null,
    last_name: parsed.last_name || null,
    email: parsed.email || null,
    phone_primary: parsed.phone_primary || null,
    phone_company: parsed.phone_company || null,
    tax_id: parsed.tax_id || null,
    origin: parsed.origin,
    potential: parsed.potential,
    notes: parsed.notes || null,
    // Si lo crea nivel 3, queda asignado a sí mismo (decisión 1.10)
    assigned_user_id: isLevel3 ? session.user_id : null,
    assigned_at: isLevel3 ? new Date().toISOString() : null,
    origin_tmk_user_id:
      parsed.origin === "tmk" && session.roles.includes("telemarketer")
        ? session.user_id
        : null,
    created_by: session.user_id,
  };
  const { data, error } = await supabase
    .from("leads")
    .insert(insertPayload as never)
    .select("id")
    .single();

  if (error) throw error;
  const newId = (data as { id: string }).id;

  // Emitir evento timeline
  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "lead",
    subject_id: newId,
    kind: "lead.created",
    payload: { party_kind: parsed.party_kind, origin: parsed.origin },
    actor_user_id: session.user_id,
  } as never);

  // Notificar a admin + directores
  const leadName =
    parsed.party_kind === "company"
      ? parsed.trade_name || parsed.legal_name || "Sin nombre"
      : `${parsed.first_name ?? ""} ${parsed.last_name ?? ""}`.trim() || "Sin nombre";
  await notifyLeadCreated(session.company_id, newId, leadName);

  revalidatePath("/leads");
  redirect(`/leads/${newId}` as never);
}

export async function updateLeadStatus(id: string, status: LeadStatus, lostReason?: string) {
  const session = await requireSession();
  const supabase = await createClient();

  const update: Record<string, unknown> = { status };
  if (status === "lost") {
    update.lost_at = new Date().toISOString();
    if (lostReason) update.lost_reason = lostReason;
  }

  const { error } = await supabase.from("leads").update(update as never).eq("id", id);
  if (error) throw error;

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "lead",
    subject_id: id,
    kind: "lead.status_changed",
    payload: { status, lost_reason: lostReason ?? null },
    actor_user_id: session.user_id,
  } as never);

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}
