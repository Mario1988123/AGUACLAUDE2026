"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { leadCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
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
  const { resolveVisibleUserIds, isLevel1 } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  const supabase = await createClient();

  // "mine" override del usuario (aunque sea admin) para ver solo los suyos
  const forceMine = filters?.scope === "mine" && !isLevel1(session);

  let query = supabase
    .from("leads")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, status, origin, potential, assigned_user_id, created_at, tags",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (forceMine) {
    query = query.eq("assigned_user_id", session.user_id);
  } else if (visibleUserIds) {
    // Nivel 3 ve los suyos; nivel 2 ve los suyos + equipo; nivel 1 todos.
    query = query.in("assigned_user_id", visibleUserIds);
  }

  // Estados visibles en /leads. Excluimos:
  //   - lost / expired: terminales sin más recorrido
  //   - converted: el lead ya pasó a cliente, vive en /clientes — no debe
  //     mantenerse como "lead convertido" en el listado de leads.
  const VALID_STATUSES: LeadStatus[] = [
    "new",
    "contacted",
    "free_trial_proposed",
    "proposal_created",
    "proposal_sent",
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

  // Cargar direcciones primarias de los leads listados
  const addrMap = new Map<
    string,
    {
      street: string | null;
      city: string | null;
      province: string | null;
      lat: number | null;
      lng: number | null;
    }
  >();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: addrs } = await sb
      .from("addresses")
      .select("lead_id, street, street_number, city, province, latitude, longitude, is_primary")
      .in("lead_id", ids)
      .eq("is_primary", true);
    for (const a of (addrs ?? []) as Array<{
      lead_id: string;
      street: string | null;
      street_number: string | null;
      city: string | null;
      province: string | null;
      latitude: number | null;
      longitude: number | null;
    }>) {
      addrMap.set(a.lead_id, {
        street: a.street
          ? `${a.street}${a.street_number ? `, ${a.street_number}` : ""}`
          : null,
        city: a.city,
        province: a.province,
        lat: a.latitude,
        lng: a.longitude,
      });
    }
  }

  // Marcar qué leads tienen propuestas (para mostrar "perdido" en lugar de
  // "eliminar" en la lista de acciones).
  const leadsWithProposals = new Set<string>();
  if (rows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: props } = await sb
      .from("proposals")
      .select("lead_id")
      .in("lead_id", rows.map((r) => r.id))
      .is("deleted_at", null);
    for (const p of (props ?? []) as { lead_id: string | null }[]) {
      if (p.lead_id) leadsWithProposals.add(p.lead_id);
    }
  }

  const now = Date.now();
  return rows.map((r) => {
    const addr =
      addrMap.get(r.id) ??
      { street: null, city: null, province: null, lat: null, lng: null };
    const isCompany = r.party_kind === "company";
    return {
      id: r.id,
      party_kind: r.party_kind,
      display_name: isCompany
        ? r.trade_name || r.legal_name || "Sin nombre"
        : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Sin nombre",
      legal_name: r.legal_name,
      contact_name: isCompany
        ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || null
        : null,
      email: r.email,
      phone_primary: r.phone_primary,
      status: r.status,
      origin: r.origin,
      potential: r.potential,
      assigned_user_id: r.assigned_user_id,
      created_at: r.created_at,
      days_since_created: Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
      tags: r.tags ?? [],
      address_street: addr.street,
      address_city: addr.city,
      address_province: addr.province,
      address_lat: addr.lat,
      address_lng: addr.lng,
      has_proposals: leadsWithProposals.has(r.id),
    };
  });
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
  const parsed = parseOrFriendly(leadCreateSchema, raw, "Lead");

  // Dirección obligatoria — el wizard front-end ya valida esto pero
  // duplicamos en server por si alguien crea por API directa. Antes el
  // lead se podía guardar con calle vacía y al convertir a cliente
  // saltaba aviso de "sin dirección" sin opción cómoda de corrección.
  if (
    !parsed.address_street?.trim() ||
    !parsed.address_postal_code?.trim() ||
    !parsed.address_city?.trim()
  ) {
    throw new Error(
      "Dirección incompleta: calle, código postal y población son obligatorios",
    );
  }

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
      street_type: parsed.address_street_type || "calle",
      street: parsed.address_street,
      street_number: parsed.address_street_number || null,
      portal: parsed.address_portal || null,
      floor: parsed.address_floor || null,
      door: parsed.address_door || null,
      postal_code: parsed.address_postal_code,
      city: parsed.address_city || null,
      province: parsed.address_province || null,
      latitude: parsed.address_latitude ?? null,
      longitude: parsed.address_longitude ?? null,
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

  // Notificar SOLO si el lead lo crea un nivel 1/2 sin asignárselo a sí mismo
  // (evita ruido cuando un comercial captura su propio lead). Si el creador es
  // nivel 3 (sales_rep / telemarketer) no notifica.
  const isLevel3Creator =
    session.roles.includes("sales_rep") || session.roles.includes("telemarketer");
  if (!isLevel3Creator) {
    const leadName =
      parsed.party_kind === "company"
        ? parsed.trade_name || parsed.legal_name || "Sin nombre"
        : `${parsed.first_name ?? ""} ${parsed.last_name ?? ""}`.trim() || "Sin nombre";
    await notifyLeadCreated(session.company_id, newId, leadName);
  }

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
  // Si NO se rellenó dirección, abrir directamente el formulario completo en
  // la ficha del lead (mismo modal que cliente, con MapPicker).
  const noAddress = !parsed.address_street || !parsed.address_postal_code;
  redirect(`/leads/${newId}${noAddress ? "?address=open" : ""}` as never);
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
  // Admin client para todo el flow. La policy customers_insert_by_scope
  // limita el INSERT a roles concretos y un nivel 3 (sales_rep) no
  // pasaba: explotaba con "new row violates row-level security policy".
  // Como ya validamos que el lead pertenece a la empresa del caller
  // arriba, es seguro usar admin para crear el customer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Si ya estaba convertido, devolver el customer_id existente sin tirar
  if (l.converted_to_customer_id) {
    await admin
      .from("proposals")
      .update({ customer_id: l.converted_to_customer_id, lead_id: null })
      .eq("lead_id", l.id);
    return l.converted_to_customer_id;
  }

  const { data: created, error: e2 } = await admin
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
      // Nivel 3: lo asignamos automáticamente al comercial que convierte.
      // Niveles 1/2 lo dejan sin asignar para que el admin lo redirija.
      assigned_user_id:
        session.is_superadmin ||
        session.roles.includes("company_admin") ||
        session.roles.includes("commercial_director") ||
        session.roles.includes("technical_director") ||
        session.roles.includes("telemarketing_director")
          ? null
          : session.user_id,
      created_by: session.user_id,
      source_lead_id: l.id,
    })
    .select("id")
    .single();
  if (e2) {
    console.error("[convertLeadToCustomer] customers insert failed:", e2.message);
    throw new Error(`No se pudo crear cliente: ${e2.message}`);
  }
  const customerId = (created as { id: string }).id;

  // Mover TODAS las propuestas del lead al nuevo cliente. Admin client
  // porque la policy proposals_update_draft bloquea updates a propuestas
  // que ya estén en accepted/sent.
  await admin
    .from("proposals")
    .update({ customer_id: customerId, lead_id: null })
    .eq("lead_id", l.id);

  // Mover direcciones del lead → cliente. Usamos admin client con UPDATE
  // directo en vez del RPC promote_lead_to_customer (que vive en schema
  // `app` y a veces no es accesible via supabase.rpc desde JS porque el
  // PostgREST API solo expone schemas en `db_schema_search_path`).
  await admin
    .from("addresses")
    .update({ customer_id: customerId, lead_id: null })
    .eq("lead_id", l.id)
    .is("deleted_at", null);

  // Admin client para garantizar el UPDATE: la policy leads_update_by_scope
  // puede dejar fuera al usuario actual según su rol/scope, y entonces el
  // status quedaría sin actualizar (lead aparecería como NO convertido y se
  // permitiría volver a "Convertir a cliente" duplicando datos).
  await admin
    .from("leads")
    .update({
      status: "converted",
      converted_at: new Date().toISOString(),
      converted_to_customer_id: customerId,
    })
    .eq("id", l.id);

  // Admin para los events: events_insert puede limitar por scope y
  // hemos visto que un nivel 3 puede no tener policy para insertar
  // events del subject_type "customer". No bloquear el conversion por
  // un audit log perdido.
  try {
    await admin.from("events").insert([
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
    ]);
  } catch (e) {
    console.error("[convertLeadToCustomer] events insert failed:", e);
    /* no bloquear */
  }

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
  // Admin client: la policy leads_update_by_scope filtra por scope (admin /
  // sales+tmk department / assigned+created_by own). Si el lead no es
  // del usuario que ejecuta (típico en bumps automáticos disparados desde
  // markProposalSent etc.), el UPDATE silente fallaba y el embudo se
  // quedaba congelado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();
  if (!data) return;
  const current = (data as { status: LeadStatus }).status;
  if (STATUS_ORDER[current] >= 99) return; // terminal
  if (STATUS_ORDER[target] <= STATUS_ORDER[current]) return;

  await admin.from("leads").update({ status: target }).eq("id", leadId);
  await admin.from("events").insert({
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

/**
 * Actualiza datos básicos del lead (nombre, contacto, notas, potencial,
 * tax_id…). NO toca status ni converted_at — para eso hay otras actions.
 */
export async function updateLeadAction(
  leadId: string,
  input: {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone_primary?: string | null;
    phone_company?: string | null;
    tax_id?: string | null;
    notes?: string | null;
    potential?: "unknown" | "A" | "B" | "C";
  },
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    payload[k] = v === "" ? null : v;
  }
  const r = await admin.from("leads").update(payload).eq("id", leadId);
  if (r.error) throw new Error(r.error.message);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

/**
 * Soft-delete de un lead que NO tiene propuestas. Si tiene propuestas
 * usa markLeadAsLostAction en su lugar (rechaza propuestas + marca lost).
 */
export async function deleteLeadAction(leadId: string): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Comprobamos primero que no tiene propuestas vivas
  const { data: props } = await admin
    .from("proposals")
    .select("id")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (props) {
    throw new Error(
      "Este lead tiene propuestas. Usa «Marcar como venta perdida» en lugar de eliminarlo.",
    );
  }
  const r = await admin
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", leadId);
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/leads");
}

/**
 * Marca un lead como venta perdida y rechaza automáticamente todas sus
 * propuestas vivas. Para usar cuando el cliente final dice que no.
 */
export async function markLeadAsLostAction(
  leadId: string,
  reason: string | null,
): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Rechazar todas las propuestas vivas del lead
  await admin
    .from("proposals")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_reason: reason
        ? `Lead marcado como venta perdida: ${reason}`
        : "Lead marcado como venta perdida",
    })
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .in("status", ["draft", "sent", "pending_approval", "accepted"]);

  // Marcar el lead como perdido
  const r = await admin
    .from("leads")
    .update({
      status: "lost",
      lost_at: new Date().toISOString(),
      lost_reason: reason,
    })
    .eq("id", leadId);
  if (r.error) throw new Error(r.error.message);

  // Evento timeline
  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "lead",
    subject_id: leadId,
    kind: "lead.status_changed",
    payload: { to: "lost", reason: reason ?? null, propuestas_rechazadas: true },
    actor_user_id: session.user_id,
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/ventas-perdidas");
}

export async function updateLeadStatus(id: string, status: LeadStatus, lostReason?: string) {
  const session = await requireSession();
  // Admin client: la policy leads_update_by_scope filtra por scope. Si el
  // usuario no es del scope del lead (típico en cambios de status hechos
  // por managers o en flujos automáticos), el UPDATE silente fallaba.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const update: Record<string, unknown> = { status };
  if (status === "lost") {
    update.lost_at = new Date().toISOString();
    if (lostReason) update.lost_reason = lostReason;
  }

  const { error } = await admin.from("leads").update(update).eq("id", id);
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
