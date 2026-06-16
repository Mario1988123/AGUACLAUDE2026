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
    .limit(2000);
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
    assigned_user_id?: string | null;
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

  // Avisos por cliente. Calculados con queries agregadas defensivas (si
  // alguna tabla no existe aún en el cache de PostgREST, queda vacío).
  const alertsMap = new Map<string, string[]>();

  // Tipo de contrato por cliente (cash/rental/renting). Se prioriza el
  // contrato activo/firmado más reciente.
  const contractMap = new Map<string, "cash" | "rental" | "renting">();

  if (baseRows.length > 0) {
    const ids = baseRows.map((c) => c.id);
    const nowIso = new Date().toISOString();
    // Troceamos los IDs: con cientos de clientes, una sola query con todos los
    // UUID se pasaría del límite de longitud de URL y fallaría (lista enriquecida
    // vacía). Cada lookup se hace por chunks de 150 y se concatena.
    const ID_CHUNK = 150;
    const idChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      idChunks.push(ids.slice(i, i + ID_CHUNK));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gather = async (build: (c: string[]) => any): Promise<any[]> => {
      const parts = await Promise.all(idChunks.map((c) => build(c)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any[] = [];
      for (const p of parts) if (p?.data) out.push(...p.data);
      return out;
    };
    const [addrsData, equipData, overdueMaintData, openIncidentsData, contractsData] =
      await Promise.all([
        gather((c) =>
          supabase
            .from("addresses")
            .select(
              "customer_id, street, city, province, latitude, longitude, is_primary",
            )
            .in("customer_id", c)
            .order("is_primary", { ascending: false }),
        ),
        // ROBUSTO: sin embeds (products/external). Resolvemos nombres por id abajo.
        gather((c) =>
          supabase
            .from("customer_equipment")
            .select("customer_id, product_id, external_equipment_model_id")
            .in("customer_id", c)
            .eq("is_active", true),
        ),
        // Mantenimientos vencidos: scheduled_at < now Y aún no completados.
        gather((c) =>
          supabase
            .from("maintenance_jobs")
            .select("customer_id")
            .in("customer_id", c)
            .lt("scheduled_at", nowIso)
            .is("completed_at", null),
        ),
        // Incidencias abiertas (no resueltas / cerradas).
        gather((c) =>
          supabase
            .from("incidents")
            .select("customer_id, status")
            .in("customer_id", c)
            .not("status", "in", "(resolved,closed,cancelled)"),
        ),
        // Contratos: para mostrar el tipo (contado/alquiler/renting) en la tabla.
        gather((c) =>
          supabase
            .from("contracts")
            .select("customer_id, plan_type, status, signed_at, created_at")
            .in("customer_id", c)
            .is("deleted_at", null),
        ),
      ]);
    // Marcar avisos
    for (const r of (overdueMaintData as Array<{ customer_id: string }>)) {
      const list = alertsMap.get(r.customer_id) ?? [];
      if (!list.includes("Mantenimiento vencido")) list.push("Mantenimiento vencido");
      alertsMap.set(r.customer_id, list);
    }
    for (const r of (openIncidentsData as Array<{ customer_id: string; status: string }>)) {
      const list = alertsMap.get(r.customer_id) ?? [];
      if (!list.includes("Incidencia abierta")) list.push("Incidencia abierta");
      alertsMap.set(r.customer_id, list);
    }
    // Tipo de contrato: elegir el más relevante por cliente (prioriza
    // active > signed > resto; dentro del mismo rango, el más reciente).
    const rankStatus = (s: string | null) =>
      s === "active" ? 3 : s === "signed" ? 2 : 1;
    const bestContract = new Map<
      string,
      { plan: "cash" | "rental" | "renting"; rank: number; date: string }
    >();
    for (const k of (contractsData as Array<{
      customer_id: string;
      plan_type: "cash" | "rental" | "renting" | null;
      status: string | null;
      signed_at: string | null;
      created_at: string | null;
    }>)) {
      if (!k.plan_type) continue;
      const rank = rankStatus(k.status);
      const date = k.signed_at ?? k.created_at ?? "";
      const cur = bestContract.get(k.customer_id);
      if (!cur || rank > cur.rank || (rank === cur.rank && date > cur.date)) {
        bestContract.set(k.customer_id, { plan: k.plan_type, rank, date });
      }
    }
    for (const [cid, v] of bestContract) contractMap.set(cid, v.plan);
    for (const a of (addrsData as Array<{
      customer_id: string;
      street: string | null;
      city: string | null;
      province: string | null;
      latitude: number | null;
      longitude: number | null;
    }>)) {
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
    // Resolver nombres de equipo por id (sin embeds → robusto).
    const equipRows = equipData as Array<{
      customer_id: string;
      product_id: string | null;
      external_equipment_model_id: string | null;
    }>;
    const pIds = Array.from(
      new Set(equipRows.map((e) => e.product_id).filter(Boolean)),
    ) as string[];
    const eIds = Array.from(
      new Set(equipRows.map((e) => e.external_equipment_model_id).filter(Boolean)),
    ) as string[];
    const pName = new Map<string, string>();
    const eName = new Map<string, string>();
    if (pIds.length > 0) {
      const { data } = await supabase
        .from("products")
        .select("id, name")
        .in("id", pIds);
      for (const p of (data as Array<{ id: string; name: string }> | null) ?? [])
        pName.set(p.id, p.name);
    }
    if (eIds.length > 0) {
      const { data } = await supabase
        .from("external_equipment_models")
        .select("id, brand, model")
        .in("id", eIds);
      for (const x of (data as Array<{
        id: string;
        brand: string | null;
        model: string | null;
      }> | null) ?? []) {
        const label = `${x.brand ?? ""} ${x.model ?? ""}`.trim();
        if (label) eName.set(x.id, label);
      }
    }
    for (const e of equipRows) {
      const cur = equipmentMap.get(e.customer_id) ?? { count: 0, firstName: null };
      cur.count += 1;
      if (!cur.firstName) {
        cur.firstName =
          (e.product_id ? pName.get(e.product_id) ?? null : null) ??
          (e.external_equipment_model_id
            ? eName.get(e.external_equipment_model_id) ?? null
            : null);
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
      assigned_user_id: c.assigned_user_id ?? null,
      address_street: addr?.street ?? null,
      address_city: addr?.city ?? null,
      address_province: addr?.province ?? null,
      address_lat: addr?.lat ?? null,
      address_lng: addr?.lng ?? null,
      equipment_summary: equipmentSummary,
      equipment_count: eq?.count ?? 0,
      alerts: alertsMap.get(c.id) ?? [],
      contract_type: contractMap.get(c.id) ?? null,
    };
  });
}

/**
 * Lista detallada de avisos abiertos para un cliente concreto.
 * Se usa en el modal emergente que aparece al entrar en la ficha.
 *
 * Cada aviso tiene un title (corto) y un detail (con datos: fecha,
 * descripción) para que el comercial sepa de un vistazo qué pasa.
 */
export interface CustomerAlertDetail {
  kind:
    | "maintenance_overdue"
    | "maintenance_upcoming"
    | "incident_open"
    | "unpaid_invoice"
    | "missing_rgpd";
  title: string;
  detail: string;
  /** Para hacer link directo al sub-recurso si procede. */
  href?: string;
}

export async function getCustomerAlertsDetail(
  customerId: string,
): Promise<CustomerAlertDetail[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // OJO: antes usaba createClient() (cliente con sesión del usuario sujeto
  // a RLS). Si las policies de incidents/maintenance_jobs bloqueaban la
  // lectura → la query devolvía 0 filas silenciosamente y el modal no
  // saltaba. Ahora usamos admin client con filtro manual de company_id
  // (seguridad equivalente, sin depender de RLS).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const nowIso = new Date().toISOString();

  const alerts: CustomerAlertDetail[] = [];

  // Incidencias abiertas. Cubrimos dos formas en las que una incidencia
  // puede estar vinculada al cliente:
  //   a) directamente: incidents.customer_id = customerId
  //   b) vía instalación: incidents.installation_id apunta a una
  //      installation con ese customer_id (el agente RRSS abre incidencias
  //      a veces sin rellenar customer_id directamente).
  try {
    // (a) por customer_id directo
    const directRes = await admin
      .from("incidents")
      .select("id, title, priority, status, created_at")
      .eq("company_id", session.company_id)
      .eq("customer_id", customerId)
      .not("status", "in", "(resolved,closed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10);
    if (directRes.error) {
      console.error("[customer-alerts] incidents direct:", directRes.error.message);
    }
    // (b) por instalaciones del cliente
    const { data: insts } = await admin
      .from("installations")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("customer_id", customerId);
    const installIds = ((insts as Array<{ id: string }> | null) ?? []).map(
      (x) => x.id,
    );
    let indirectRows: Array<{
      id: string;
      title: string;
      priority: string;
      status: string;
      created_at: string;
    }> = [];
    if (installIds.length > 0) {
      const indirectRes = await admin
        .from("incidents")
        .select("id, title, priority, status, created_at")
        .eq("company_id", session.company_id)
        .in("installation_id", installIds)
        .not("status", "in", "(resolved,closed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (indirectRes.error) {
        console.error(
          "[customer-alerts] incidents indirect:",
          indirectRes.error.message,
        );
      }
      indirectRows = (indirectRes.data ?? []) as typeof indirectRows;
    }
    // Merge y dedupe por id
    const seen = new Set<string>();
    const merged = [
      ...((directRes.data ?? []) as typeof indirectRows),
      ...indirectRows,
    ].filter((i) => (seen.has(i.id) ? false : seen.add(i.id)));

    for (const i of merged) {
      const date = new Date(i.created_at).toLocaleDateString("es-ES");
      const prio =
        i.priority === "critical"
          ? "🔴 Crítica"
          : i.priority === "high"
            ? "🟠 Alta"
            : i.priority === "medium"
              ? "🟡 Media"
              : "Normal";
      alerts.push({
        kind: "incident_open",
        title: "Incidencia abierta",
        detail: `${prio} · ${i.title} · desde ${date}`,
        href: `/incidencias/${i.id}`,
      });
    }
  } catch (e) {
    console.error(
      "[customer-alerts] incidents fail:",
      e instanceof Error ? e.message : e,
    );
  }

  // Mantenimientos: vencidos + próximos (en los siguientes 14 días).
  // OJO: la tabla maintenance_jobs NO tiene columna "title". Las columnas
  // reales son kind/status/scheduled_at/completed_at/notes.
  try {
    const in14d = new Date(Date.now() + 14 * 86400_000).toISOString();
    const maintRes = await admin
      .from("maintenance_jobs")
      .select("id, scheduled_at, kind, notes")
      .eq("company_id", session.company_id)
      .eq("customer_id", customerId)
      .is("completed_at", null)
      .lte("scheduled_at", in14d)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true })
      .limit(10);
    if (maintRes.error) {
      console.error("[customer-alerts] maintenance:", maintRes.error.message);
    }
    const KIND_LABEL: Record<string, string> = {
      contracted: "Mantenimiento contratado",
      one_off: "Mantenimiento puntual",
      warranty: "Mantenimiento en garantía",
    };
    for (const m of ((maintRes.data as Array<{
      id: string;
      scheduled_at: string;
      kind: string;
      notes: string | null;
    }> | null) ?? [])) {
      const schedule = new Date(m.scheduled_at);
      const isOverdue = schedule.getTime() < Date.now();
      const date = schedule.toLocaleDateString("es-ES");
      const label = KIND_LABEL[m.kind] ?? "Mantenimiento";
      const daysDiff = Math.round(
        (schedule.getTime() - Date.now()) / 86400_000,
      );
      let detail: string;
      if (isOverdue) {
        detail = `${label} · estaba programado ${date} (${Math.abs(daysDiff)} días vencido)`;
      } else {
        const dayWord = daysDiff === 1 ? "día" : "días";
        detail = `${label} · programado ${date} (en ${daysDiff} ${dayWord})`;
      }
      if (m.notes) detail += ` · ${m.notes.slice(0, 60)}`;
      alerts.push({
        kind: isOverdue ? "maintenance_overdue" : "maintenance_upcoming",
        title: isOverdue ? "Mantenimiento vencido" : "Mantenimiento próximo",
        detail,
        href: `/mantenimientos/${m.id}`,
      });
    }
  } catch (e) {
    console.error(
      "[customer-alerts] maintenance fail:",
      e instanceof Error ? e.message : e,
    );
  }

  return alerts;
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
    // Patrón result: en producción Next redacta el mensaje de un throw, así que
    // el aviso de duplicado (útil para el comercial) se perdía. Lo devolvemos.
    return {
      ok: false as const,
      error: `Duplicado: ${fieldLabel} ya registrado en ${first.entity === "lead" ? "lead" : "cliente"} "${first.display_name}"${first.assigned_user_name ? ` (asignado a ${first.assigned_user_name})` : ""}`,
    };
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
    // SEGURIDAD: source_lead_id viene del navegador. Verificar que el lead es
    // de tu empresa ANTES de convertirlo y de mover sus direcciones; si no,
    // un usuario podría convertir un lead ajeno y ROBARSE sus direcciones (PII).
    const { data: ownLead } = await admin
      .from("leads")
      .select("id")
      .eq("id", parsed.source_lead_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (ownLead) {
      await admin
        .from("leads")
        .update({
          status: "converted",
          converted_at: new Date().toISOString(),
          converted_to_customer_id: newId,
        })
        .eq("id", parsed.source_lead_id)
        .eq("company_id", session.company_id);
      // Mover direcciones del lead al customer (UPDATE directo con admin —
      // el RPC vive en schema `app` y no siempre es accesible vía REST).
      await admin
        .from("addresses")
        .update({ customer_id: newId, lead_id: null })
        .eq("lead_id", parsed.source_lead_id)
        .eq("company_id", session.company_id)
        .is("deleted_at", null);
    }
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
  // SEGURIDAD: admin client salta RLS → filtrar por company_id para no
  // sobrescribir datos de clientes de otra empresa con su UUID.
  let r = await admin
    .from("customers")
    .update(cleaned)
    .eq("id", customerId)
    .eq("company_id", session.company_id)
    .select("id");
  // Defensa schema cache para is_autonomo
  if (r.error && /is_autonomo/i.test(r.error.message ?? "")) {
    delete cleaned.is_autonomo;
    r = await admin
      .from("customers")
      .update(cleaned)
      .eq("id", customerId)
      .eq("company_id", session.company_id)
      .select("id");
  }
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Cliente no encontrado o no pertenece a tu empresa");

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
