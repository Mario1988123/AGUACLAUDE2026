"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { customerCreateSchema, customerUpdateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { CustomerDetail, CustomerListItem } from "./types";
import { checkDedupe } from "@/shared/lib/dedupe/check-dedupe";
import { normalizeSpanishPhone } from "@/shared/lib/validations/spanish";

// Helper local: normaliza si el formato es válido, sino devuelve original
function normalizePhoneSafe(v: string | null | undefined): string | null {
  if (!v) return null;
  return normalizeSpanishPhone(v) ?? v;
}

export async function listCustomers(
  q?: string,
  scope?: "mine" | "all",
): Promise<CustomerListItem[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds, isLevel1 } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  const supabase = await createClient();
  // "mine" fuerza al propio user (override del usuario aunque sea admin).
  const forceMine = scope === "mine" && !isLevel1(session);

  // Intentamos cargar `is_autonomo` con un SELECT con coalesce — si la
  // columna no existe en el cache de PostgREST, caemos al SELECT legacy.
  const SELECT_FULL =
    "id, party_kind, is_autonomo, legal_name, trade_name, first_name, last_name, email, phone_primary, is_active, created_at, assigned_user_id";
  const SELECT_LEGACY =
    "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, is_active, created_at, assigned_user_id";
  let query = supabase
    .from("customers")
    .select(SELECT_FULL)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  // Scope: nivel 3 ve los suyos; nivel 2 ve los suyos + equipo;
  // nivel 1 ve todos. assigned_user_id es la columna de pertenencia.
  if (visibleUserIds && !forceMine) {
    query = query.in("assigned_user_id", visibleUserIds);
  } else if (forceMine || (scope === "mine" && !visibleUserIds)) {
    query = query.eq("assigned_user_id", session.user_id);
  }
  if (q) {
    const c = q.replace(/[%_]/g, "");
    query = query.or(
      `legal_name.ilike.%${c}%,trade_name.ilike.%${c}%,first_name.ilike.%${c}%,last_name.ilike.%${c}%,email.ilike.%${c}%,phone_primary.ilike.%${c}%`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any = await query;
  if (
    res.error &&
    /is_autonomo|schema cache|Could not find/i.test(res.error.message ?? "")
  ) {
    // Reintento con columnas legacy si is_autonomo no está visible.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q2: any = supabase
      .from("customers")
      .select(SELECT_LEGACY)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (visibleUserIds && !forceMine) {
      q2 = q2.in("assigned_user_id", visibleUserIds);
    } else if (forceMine || (scope === "mine" && !visibleUserIds)) {
      q2 = q2.eq("assigned_user_id", session.user_id);
    }
    if (q) {
      const c = q.replace(/[%_]/g, "");
      q2 = q2.or(
        `legal_name.ilike.%${c}%,trade_name.ilike.%${c}%,first_name.ilike.%${c}%,last_name.ilike.%${c}%,email.ilike.%${c}%,phone_primary.ilike.%${c}%`,
      );
    }
    res = await q2;
  }
  const { data, error } = res;
  if (error) throw error;
  const baseRows = (data as Array<{
    id: string;
    party_kind: "individual" | "company";
    is_autonomo?: boolean | null;
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    is_active: boolean;
    created_at: string;
  }>);

  // Cargar equipos instalados (sólo activos) en paralelo a direcciones
  const equipmentMap = new Map<
    string,
    { count: number; firstName: string | null }
  >();

  // Cargar dirección primaria de cada cliente (1 query bulk)
  const addressMap = new Map<
    string,
    {
      street: string | null;
      city: string | null;
      province: string | null;
      lat: number | null;
      lng: number | null;
    }
  >();
  if (baseRows.length > 0) {
    const ids = baseRows.map((c) => c.id);
    const [addrsRes, equipRes] = await Promise.all([
      supabase
        .from("addresses")
        .select("customer_id, street, city, province, latitude, longitude, is_primary")
        .in("customer_id", ids)
        .order("is_primary", { ascending: false }),
      supabase
        .from("customer_equipment")
        .select(
          "customer_id, product_id, external_equipment_model_id, products(name), external_equipment_models(name)",
        )
        .in("customer_id", ids)
        .eq("is_active", true),
    ]);
    for (const a of ((addrsRes.data as Array<{
      customer_id: string;
      street: string | null;
      city: string | null;
      province: string | null;
      latitude: number | null;
      longitude: number | null;
    }> | null) ?? [])) {
      if (!addressMap.has(a.customer_id)) {
        addressMap.set(a.customer_id, {
          street: a.street,
          city: a.city,
          province: a.province,
          lat: a.latitude,
          lng: a.longitude,
        });
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of ((equipRes.data as any[] | null) ?? [])) {
      const cur = equipmentMap.get(e.customer_id) ?? { count: 0, firstName: null };
      cur.count += 1;
      if (!cur.firstName) {
        cur.firstName = e.products?.name ?? e.external_equipment_models?.name ?? null;
      }
      equipmentMap.set(e.customer_id, cur);
    }
  }

  return baseRows.map((c) => {
    const addr = addressMap.get(c.id);
    const eq = equipmentMap.get(c.id);
    let equipmentSummary: string | null = null;
    if (eq && eq.count > 0) {
      equipmentSummary = eq.firstName ?? "Equipo";
      if (eq.count > 1) equipmentSummary += ` +${eq.count - 1}`;
    }
    return {
      id: c.id,
      party_kind: c.party_kind,
      is_autonomo: c.is_autonomo ?? false,
      display_name:
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      contact_name:
        c.party_kind === "company"
          ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null
          : null,
      email: c.email,
      phone_primary: c.phone_primary,
      is_active: c.is_active,
      created_at: c.created_at,
      address_street: addr?.street ?? null,
      address_city: addr?.city ?? null,
      address_province: addr?.province ?? null,
      address_lat: addr?.lat ?? null,
      address_lng: addr?.lng ?? null,
      equipment_summary: equipmentSummary,
      equipment_count: eq?.count ?? 0,
    };
  });
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

  const { rateLimit } = await import("@/shared/lib/rate-limit");
  rateLimit(`customer_create:${session.user_id}`, 20, 60_000);

  const raw = Object.fromEntries(formData.entries());
  const parsed = parseOrFriendly(customerCreateSchema, raw, "Cliente");

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
  const insertPayload: Record<string, unknown> = {
    company_id: session.company_id,
    party_kind: parsed.party_kind,
    // Solo guardamos is_autonomo si es company (en individual no aplica).
    is_autonomo: parsed.party_kind === "company" ? !!parsed.is_autonomo : false,
    legal_name: parsed.legal_name || null,
    trade_name: parsed.trade_name || null,
    first_name: parsed.first_name || null,
    last_name: parsed.last_name || null,
    email: parsed.email || null,
    phone_primary: normalizePhoneSafe(parsed.phone_primary),
    phone_secondary: normalizePhoneSafe(parsed.phone_secondary),
    tax_id: parsed.tax_id || null,
    notes: parsed.notes || null,
    source_lead_id: parsed.source_lead_id || null,
    assigned_user_id: isLevel3 ? session.user_id : null,
    assigned_at: isLevel3 ? new Date().toISOString() : null,
    created_by: session.user_id,
  };
  let res = await supabase
    .from("customers")
    .insert(insertPayload as never)
    .select("id")
    .single();
  // Defensa schema cache: si is_autonomo no existe (migración no aplicada),
  // reintentamos sin él para no bloquear el alta.
  if (
    res.error &&
    /is_autonomo/i.test(res.error.message ?? "")
  ) {
    delete insertPayload.is_autonomo;
    res = await supabase
      .from("customers")
      .insert(insertPayload as never)
      .select("id")
      .single();
  }
  const { data, error } = res;
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

  // Si NO viene de lead (alta directa), notificar a admin/director
  // comercial para que sepan del nuevo cliente.
  if (!parsed.source_lead_id) {
    try {
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      const customerName =
        parsed.party_kind === "company"
          ? parsed.trade_name || parsed.legal_name || "Sin nombre"
          : `${parsed.first_name ?? ""} ${parsed.last_name ?? ""}`.trim() ||
            "Sin nombre";
      await notifyByRoles(
        session.company_id,
        ["company_admin", "commercial_director"],
        {
          kind: "customer.created",
          severity: "info",
          title: "Nuevo cliente",
          body: customerName,
          subject_type: "customer",
          subject_id: newId,
          action_url: `/clientes/${newId}`,
        },
      );
    } catch {
      /* no-op */
    }
  }

  revalidatePath("/clientes");
  redirect(`/clientes/${newId}` as never);
}

/**
 * Registra contacto (call/whatsapp/email) en agenda + timeline para un cliente.
 */
/**
 * Actualiza los datos básicos del cliente. Comprueba dedupe de DNI/CIF
 * antes de guardar (con admin para no chocar con RLS).
 */
export async function updateCustomerAction(
  customerId: string,
  patch: {
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone_primary?: string | null;
    phone_secondary?: string | null;
    tax_id?: string | null;
    notes?: string | null;
    is_autonomo?: boolean;
  },
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // Validación de formato (DNI/CIF, teléfonos, email). Cargamos
  // party_kind + is_autonomo del cliente para validar tax_id según
  // corresponda (autónomo = DNI/NIE, no CIF).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminPre = createAdminClient() as any;
  let partyKind: "individual" | "company" | undefined;
  let isAutonomo = false;
  try {
    let curRes = await adminPre
      .from("customers")
      .select("party_kind, is_autonomo")
      .eq("id", customerId)
      .maybeSingle();
    if (
      curRes.error &&
      /is_autonomo|schema cache|Could not find/i.test(curRes.error.message ?? "")
    ) {
      curRes = await adminPre
        .from("customers")
        .select("party_kind")
        .eq("id", customerId)
        .maybeSingle();
    }
    const cur = curRes.data as
      | { party_kind?: "individual" | "company"; is_autonomo?: boolean | null }
      | null;
    partyKind = cur?.party_kind;
    isAutonomo = Boolean(cur?.is_autonomo);
  } catch {
    /* sin party_kind, validador acepta cualquiera de los formatos */
  }
  // Si el patch trae is_autonomo, lo usamos como autoridad (caso edición
  // donde se cambia el flag al mismo tiempo que el DNI).
  if (typeof patch.is_autonomo === "boolean") {
    isAutonomo = patch.is_autonomo;
  }
  // Convertimos null → string vacío para que el schema valide bien
  const validatable: Record<string, unknown> = {
    party_kind: partyKind,
    is_autonomo: isAutonomo,
  };
  for (const [k, v] of Object.entries(patch)) {
    validatable[k] = v ?? "";
  }
  const parsed = customerUpdateSchema.safeParse(validatable);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first?.message ?? "Datos inválidos");
  }

  // Dedupe de tax_id si se está cambiando: validar que no choque con
  // otro cliente de la misma empresa.
  if (patch.tax_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = createAdminClient() as any;
    const { data: collision } = await dup
      .from("customers")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("tax_id", patch.tax_id)
      .neq("id", customerId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (collision) {
      throw new Error("Ya existe otro cliente con ese DNI/CIF");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    cleaned[k] = v === "" ? null : v;
  }
  let r = await admin.from("customers").update(cleaned).eq("id", customerId);
  // Defensa schema cache para is_autonomo
  if (r.error && /is_autonomo/i.test(r.error.message ?? "")) {
    delete cleaned.is_autonomo;
    r = await admin.from("customers").update(cleaned).eq("id", customerId);
  }
  if (r.error) throw new Error(r.error.message);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "customer",
    subject_id: customerId,
    kind: "customer.updated",
    payload: Object.keys(patch),
    actor_user_id: session.user_id,
  });

  revalidatePath(`/clientes/${customerId}`);
}

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

// ============================================================================
// Safe wrappers (result pattern) — 2026-05-20
// ============================================================================

export async function updateCustomerSafeAction(
  customerId: string,
  patch: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateCustomerAction(customerId, patch as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function logCustomerContactSafeAction(
  customerId: string,
  channel: "call" | "whatsapp" | "email",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await logCustomerContactAction(customerId, channel);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
