"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { leadCreateSchema } from "./schemas";
import type { LeadDetail, LeadListItem, LeadStatus } from "./types";
import { notifyLeadCreated } from "@/modules/notifications/notifier";
import { checkDedupe } from "@/shared/lib/dedupe/check-dedupe";
import { awardPoints, getPointsSettings } from "@/modules/points/award";

export async function listLeads(filters?: {
  status?: LeadStatus;
  q?: string;
  scope?: "mine" | "all";
}): Promise<LeadListItem[]> {
  const session = await requireSession();
  const supabase = await createClient();

  // Si nivel 3 (sin rol superior) → siempre "mine" (RLS lo hará igual, pero
  // explícito para queries más eficientes)
  const isUpperLevel =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director") ||
    session.roles.includes("technical_director");
  const scope = !isUpperLevel ? "mine" : (filters?.scope ?? "all");

  let query = supabase
    .from("leads")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, status, origin, potential, assigned_user_id, created_at, tags",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope === "mine") {
    query = query.eq("assigned_user_id", session.user_id);
  }

  // Estados visibles en /leads (excluye terminales lost/expired pero incluye
  // converted para que se vea el embudo completo). Filtro explícito en lugar
  // de NOT IN para evitar ambigüedades de sintaxis PostgREST que dejaban el
  // listado vacío en algunos casos (bug del lead reabierto).
  const VALID_STATUSES: LeadStatus[] = [
    "new",
    "contacted",
    "free_trial_proposed",
    "proposal_created",
    "proposal_sent",
    "converted",
  ];
  if (filters?.status) {
    query = query.eq("status", filters.status);
  } else {
    query = query.in("status", VALID_STATUSES);
  }
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
    tags: string[] | null;
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
    tags: r.tags ?? [],
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

  // Anti-duplicado server-side (cubre el caso de dos comerciales creando a la vez)
  const dups = await checkDedupe({
    tax_id: parsed.tax_id || undefined,
    email: parsed.email || undefined,
    phone: parsed.phone_primary || undefined,
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

  // Si rellenó la dirección opcional al crear, persistirla como principal
  if (parsed.address_street && parsed.address_postal_code) {
    await supabase.from("addresses").insert({
      company_id: session.company_id,
      lead_id: newId,
      kind: parsed.party_kind === "company" ? "office" : "home",
      is_primary: true,
      street_type: "calle",
      street: parsed.address_street,
      street_number: parsed.address_street_number || null,
      postal_code: parsed.address_postal_code,
      city: parsed.address_city || null,
      province: parsed.address_province || null,
    } as never);
  }

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

  // Puntos: lead captado por telemarketer (origin tmk)
  if (parsed.origin === "tmk" && session.roles.includes("telemarketer")) {
    try {
      const cfg = await getPointsSettings(session.company_id);
      await awardPoints({
        company_id: session.company_id,
        user_id: session.user_id,
        points: cfg.points_lead_captured,
        reason: "lead_captured",
        subject_type: "lead",
        subject_id: newId,
      });
    } catch {
      /* no-op fail-soft */
    }
  }

  revalidatePath("/leads");
  redirect(`/leads/${newId}` as never);
}

/**
 * Convierte un lead en cliente: crea customer copiando datos del lead, mueve
 * todas sus direcciones (RPC promote_lead_to_customer) y marca el lead como
 * 'converted' con converted_to_customer_id.
 */
export async function convertLeadToCustomerAction(leadId: string): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: lead, error: e1 } = await supabase
    .from("leads")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, phone_company, tax_id, notes, status, converted_to_customer_id",
    )
    .eq("id", leadId)
    .is("deleted_at", null)
    .single();
  if (e1) throw e1;
  const l = lead as {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    phone_company: string | null;
    tax_id: string | null;
    notes: string | null;
    status: string;
    converted_to_customer_id: string | null;
  };
  if (l.converted_to_customer_id) {
    throw new Error("Lead ya convertido");
  }

  const { data: created, error: e2 } = await supabase
    .from("customers")
    .insert({
      company_id: session.company_id,
      party_kind: l.party_kind,
      legal_name: l.legal_name,
      trade_name: l.trade_name,
      first_name: l.first_name,
      last_name: l.last_name,
      email: l.email,
      phone_primary: l.phone_primary,
      phone_secondary: l.phone_company,
      tax_id: l.tax_id,
      notes: l.notes,
      is_active: true,
      created_by: session.user_id,
      source_lead_id: l.id,
    })
    .select("id")
    .single();
  if (e2) throw new Error(e2.message);
  const customerId = (created as { id: string }).id;

  // Mover direcciones via RPC (security definer + tenant check)
  await supabase.rpc("promote_lead_to_customer", {
    p_lead_id: l.id,
    p_customer_id: customerId,
  });

  await supabase
    .from("leads")
    .update({
      status: "converted",
      converted_at: new Date().toISOString(),
      converted_to_customer_id: customerId,
    } as never)
    .eq("id", l.id);

  await supabase.from("events").insert([
    {
      company_id: session.company_id,
      subject_type: "lead",
      subject_id: l.id,
      kind: "lead.converted",
      payload: { customer_id: customerId },
      actor_user_id: session.user_id,
    },
    {
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: customerId,
      kind: "customer.created",
      payload: { from_lead_id: l.id },
      actor_user_id: session.user_id,
    },
  ] as never);

  revalidatePath(`/leads/${l.id}`);
  revalidatePath("/leads");
  revalidatePath("/clientes");
  return customerId;
}

/**
 * Orden de progresión de estados. Sólo subimos, nunca bajamos.
 * 'lost' y 'expired' son terminales — no se promueven automáticamente.
 */
const STATUS_ORDER: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  free_trial_proposed: 2,
  proposal_created: 3,
  proposal_sent: 4,
  converted: 5,
  lost: 99,
  expired: 99,
};

/**
 * Sube el estado del lead al objetivo si y sólo si está más adelante en el flujo
 * y no es un estado terminal. No-op si ya está igual o más avanzado.
 */
export async function bumpLeadStatus(leadId: string, target: LeadStatus): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();
  if (!data) return;
  const current = (data as { status: LeadStatus }).status;
  if (STATUS_ORDER[current] >= 99) return; // terminal
  if (STATUS_ORDER[target] <= STATUS_ORDER[current]) return;

  await supabase.from("leads").update({ status: target }).eq("id", leadId);
  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "lead",
    subject_id: leadId,
    kind: "lead.status_changed",
    payload: { from: current, to: target, auto: true },
    actor_user_id: session.user_id,
  });
}

/**
 * Registra contacto (call/whatsapp/email) en agenda + timeline + bump a contacted.
 */
export async function logLeadContactAction(
  leadId: string,
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
    title: `${titleMap[channel]} a lead`,
    starts_at: now,
    assigned_user_id: session.user_id,
    subject_type: "lead",
    subject_id: leadId,
    created_by: session.user_id,
  });

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "lead",
    subject_id: leadId,
    kind: "lead.contacted",
    payload: { channel },
    actor_user_id: session.user_id,
  });

  await bumpLeadStatus(leadId, "contacted");
  revalidatePath(`/leads/${leadId}`);
}

export async function updateLeadStatus(id: string, status: LeadStatus, lostReason?: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const update: Record<string, unknown> = { status };
  if (status === "lost") {
    update.lost_at = new Date().toISOString();
    if (lostReason) update.lost_reason = lostReason;
  }

  const { error } = await supabase.from("leads").update(update).eq("id", id);
  if (error) throw error;

  // Si pierde, registrar en lost_sales (idempotente: sólo si no existe ya)
  if (status === "lost") {
    const { data: existing } = await supabase
      .from("lost_sales")
      .select("id")
      .eq("lead_id", id)
      .eq("origin", "lead_lost")
      .limit(1)
      .maybeSingle();
    if (!existing) {
      await supabase.from("lost_sales").insert({
        company_id: session.company_id,
        origin: "lead_lost",
        lead_id: id,
        reason: lostReason ?? null,
        is_recovered: false,
        created_by: session.user_id,
      });
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "lead",
    subject_id: id,
    kind: "lead.status_changed",
    payload: { status, lost_reason: lostReason ?? null },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  revalidatePath("/ventas-perdidas");
}
