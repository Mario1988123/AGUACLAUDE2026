"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { agendaCreateSchema, AGENDA_KIND } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import {
  madridHour,
  madridMinutesOfDay,
  madridIsoDow,
  madridJsDay,
  madridDayRangeUtc,
  madridLocalToUtcISO,
} from "@/shared/lib/format-date";

/**
 * Decide si una fecha cae fuera del horario laboral. Prioridad:
 *
 *  1. Si el evento tiene asignado un usuario y ese usuario tiene
 *     user_work_schedules para el día → usar SU horario.
 *  2. Si no, usar company_settings.business_hours.
 *  3. Si no hay ninguno → fallback hardcoded 9-18 lun-vie.
 *
 * Esto evita el bug "una tarea de Mario a las 10:20 sale como fuera de
 * horario" cuando el horario corporativo decía cerrado pero el horario
 * de Mario es 9-18.
 *
 * `user_work_schedules.day_of_week`: 0=Lunes ... 6=Domingo (definición
 * de la migración 20260503320000).
 *
 * `Date.getDay()` (JS): 0=Sun ... 6=Sat. Convertir: jsToIsoDow.
 */
async function computeIsOutsideHours(
  d: Date,
  companyId: string,
  assignedUserId: string | null,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Horario del usuario asignado (si lo hay)
  if (assignedUserId) {
    try {
      // Día de la semana ISO (lunes=0...domingo=6) EN HORA MADRID. Antes era
      // d.getDay() en hora del servidor (UTC) y descuadraba cerca de medianoche.
      const isoDow = madridIsoDow(d);
      const { data: sched } = await admin
        .from("user_work_schedules")
        .select("starts_at, ends_at")
        .eq("user_id", assignedUserId)
        .eq("day_of_week", isoDow)
        .maybeSingle();
      const s = sched as { starts_at: string | null; ends_at: string | null } | null;
      if (s && s.starts_at && s.ends_at) {
        return inTimeRange(d, s.starts_at, s.ends_at) ? false : true;
      }
      // Si el usuario tiene un row para ese día pero starts_at/ends_at son
      // null → día libre. Y si NO tiene row → fallback al horario empresa.
      if (s && (s.starts_at == null || s.ends_at == null)) return true;
    } catch {
      /* fallback */
    }
  }

  // 2) Horario corporativo
  let bh: Record<string, { open: string; close: string } | null> | null = null;
  try {
    const { data: cs } = await admin
      .from("company_settings")
      .select("business_hours")
      .eq("company_id", companyId)
      .maybeSingle();
    bh = (cs as { business_hours: typeof bh } | null)?.business_hours ?? null;
  } catch {
    /* no-op */
  }
  if (bh) {
    const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    const slot = (bh as Record<string, { open: string; close: string } | null>)[
      KEYS[madridJsDay(d)]!
    ];
    if (!slot) return true;
    return inTimeRange(d, slot.open, slot.close) ? false : true;
  }

  // 3) Fallback 9-18 lun-vie (en hora Madrid)
  const day = madridJsDay(d);
  const hour = madridHour(d);
  return day === 0 || day === 6 || hour < 9 || hour > 18;
}

/** Acepta "HH:MM" o "HH:MM:SS" y comprueba si la hora Madrid de d cae dentro. */
function inTimeRange(d: Date, openHHMM: string, closeHHMM: string): boolean {
  const [oh, om] = openHHMM.split(":").map(Number);
  const [ch, cm] = closeHHMM.split(":").map(Number);
  const minutes = madridMinutesOfDay(d);
  return (
    minutes >= (oh ?? 0) * 60 + (om ?? 0) &&
    minutes <= (ch ?? 23) * 60 + (cm ?? 59)
  );
}

export interface AgendaItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  assigned_user_id: string | null;
  is_outside_hours: boolean;
  subject_type: string | null;
  subject_id: string | null;
  /** Nombre del cliente/lead vinculado a la tarea (si lo hay), para
   *  mostrarlo en la agenda. Lo rellena enrichTitlesFromSubjects. */
  subject_label?: string | null;
  /** Dirección de instalación del cliente/lead (texto), para que el instalador
   *  la vea sin abrir la ficha (que su rol puede no permitirle). */
  subject_address?: string | null;
  /** Coordenadas para el botón "Ir con Google Maps". */
  subject_lat?: number | null;
  subject_lng?: number | null;
  /** Teléfono del cliente/lead para llamar / WhatsApp desde la tarea. */
  subject_phone?: string | null;
}

export async function listAgendaMonth(
  year: number,
  month: number,
  filters?: { user_id?: string; kind?: string },
): Promise<AgendaItem[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 2, 0).toISOString(); // mes anterior + actual + sig
  const isLevel1or2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  let query = supabase
    .from("agenda_events")
    .select(
      "id, kind, status, title, description, starts_at, ends_at, assigned_user_id, is_outside_hours, subject_type, subject_id",
    )
    .is("deleted_at", null)
    .gte("starts_at", start)
    .lte("starts_at", end)
    .order("starts_at");
  // Scope + filtro "Asignado a". Nivel 3 (sales_rep/tmk/installer) solo ve lo
  // suyo. Nivel 1/2 puede acotar el calendario a un miembro concreto vía
  // ?user=... — sin esto el calendario del MES ignoraba el filtro y "salía
  // todo" aunque eligieras a una persona (el listado sí filtraba, el mes no).
  if (!isLevel1or2) {
    query = query.eq("assigned_user_id", session.user_id);
  } else if (filters?.user_id) {
    query = query.eq("assigned_user_id", filters.user_id);
  }
  if (filters?.kind) {
    query = query.eq("kind", filters.kind);
  }
  const { data, error } = await query;
  if (error) throw error;
  const events = (data ?? []) as AgendaItem[];

  // Si se filtra por un kind tradicional de agenda_events (visit/call/...) no
  // añadimos virtuales: esos virtuales son installation/maintenance, kinds
  // distintos. Mismo criterio que listAgendaRangeFull.
  let merged: AgendaItem[] = events;
  if (!filters?.kind) {
    // Añadir instalaciones y mantenimientos programados (bug 2026-05-11:
    // si markContractSigned NO consigue crear el row de agenda_events por
    // fail-soft, la instalación tenía scheduled_at pero NO aparecía en
    // agenda. Ahora las leemos directas de installations + maintenance_jobs).
    // Respetamos el mismo filtro "Asignado a" que aplicamos arriba.
    const restrictUid = !isLevel1or2 ? session.user_id : filters?.user_id ?? null;
    const virtuals = await loadVirtualAgendaItems({
      from: start,
      to: end,
      restrictToUserId: restrictUid,
      companyId: session.company_id ?? null,
    });

    // Dedupe: clave primaria subject_type:subject_id, secundaria por
    // (reference_code en title + starts_at) para cubrir agenda_events
    // antiguos sin subject_id.
    const existingKey = new Set(
      events
        .filter((e) => e.subject_type && e.subject_id)
        .map((e) => `${e.subject_type}:${e.subject_id}`),
    );
    const refRegex = /\b([IM]-\d{4}-\d{4})\b/;
    const existingRefAt = new Set(
      events
        .map((e) => {
          const m = refRegex.exec(e.title);
          return m ? `${m[1]}@${e.starts_at}` : null;
        })
        .filter((k): k is string => !!k),
    );
    merged = [
      ...events,
      ...virtuals.filter((v) => {
        if (existingKey.has(`${v.subject_type}:${v.subject_id}`)) return false;
        const m = refRegex.exec(v.title);
        if (m && existingRefAt.has(`${m[1]}@${v.starts_at}`)) return false;
        return true;
      }),
    ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  await enrichTitlesFromSubjects(merged, session.company_id);
  return await recomputeOutsideHoursForList(merged, session.company_id);
}

export async function listAgenda(
  daysAhead = 14,
  filters?: { user_id?: string; kind?: string },
): Promise<AgendaItem[]> {
  // Implementación: delegamos en listAgendaRange con [start-of-today, +daysAhead].
  // "Hoy" se calcula en hora Madrid, no en hora del servidor (UTC).
  const now = new Date();
  const startOfToday = madridDayRangeUtc(now).start;
  const until = new Date(now.getTime() + daysAhead * 86400000);
  return listAgendaRange(startOfToday.toISOString(), until.toISOString(), filters);
}

/**
 * Igual que listAgenda pero con rango arbitrario. Útil para la vista
 * semanal de la agenda, que necesita cargar la semana visible aunque
 * incluya días anteriores a hoy (lunes/martes de la semana en curso si
 * hoy es jueves, por ejemplo). El cron daily crea instalaciones desde
 * primera hora, así que el caller suele pasar inicio-de-día en local.
 */
export interface ListAgendaRangeOptions {
  user_id?: string;
  kind?: string;
  /** Estado(s) a incluir. Si se omite trae todos los estados.
   *  Útil para vista listado donde el usuario filtra por "Programado"
   *  o "Completado". Aplica solo a agenda_events (los virtuales ya
   *  vienen pre-filtrados a scheduled/in_progress). */
  status?: string[];
  /** Tope de filas devueltas tras merge. Defensa contra empresas con
   *  miles de mantenimientos en el rango. Default 500. */
  limit?: number;
}

export interface ListAgendaRangeResult {
  events: AgendaItem[];
  truncated: boolean;
  total_before_limit: number;
}

export async function listAgendaRange(
  fromIso: string,
  toIso: string,
  filters?: ListAgendaRangeOptions,
): Promise<AgendaItem[]> {
  const r = await listAgendaRangeFull(fromIso, toIso, filters);
  return r.events;
}

/** Versión que también expone si la respuesta se truncó. Pensada para la
 *  vista listado, que muestra banner cuando llegamos al cap. */
export async function listAgendaRangeFull(
  fromIso: string,
  toIso: string,
  filters?: ListAgendaRangeOptions,
): Promise<ListAgendaRangeResult> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const limit = Math.max(50, Math.min(filters?.limit ?? 500, 2000));

  const isLevel1or2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  let query = supabase
    .from("agenda_events")
    .select(
      "id, kind, status, title, description, starts_at, ends_at, assigned_user_id, is_outside_hours, subject_type, subject_id",
    )
    .is("deleted_at", null)
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .order("starts_at");

  // Scope. Si el caller es nivel 3 (sales_rep, telemarketer, installer) NO
  // puede ver agenda de otros: forzamos filter.user_id = self.
  if (!isLevel1or2) {
    query = query.eq("assigned_user_id", session.user_id);
  } else if (filters?.user_id) {
    query = query.eq("assigned_user_id", filters.user_id);
  }

  if (filters?.kind) {
    query = query.eq("kind", filters.kind);
  }
  if (filters?.status && filters.status.length > 0) {
    query = query.in("status", filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  const events = (data ?? []) as AgendaItem[];

  // Si el filtro pide kind específico, no añadimos virtuales (esos kinds
  // virtuales son 'installation' / 'maintenance', distintos de los kinds
  // tradicionales de agenda_events: visit/call/manual/meeting/reminder).
  let merged: AgendaItem[] = events;
  if (!filters?.kind) {
    const restrictUid = !isLevel1or2
      ? session.user_id
      : filters?.user_id ?? null;
    const virtuals = await loadVirtualAgendaItems({
      from: fromIso,
      to: toIso,
      restrictToUserId: restrictUid,
      companyId: session.company_id ?? null,
    });
    // Dedupe: clave primaria subject_type:subject_id, clave secundaria
    // por (starts_at + reference_code en title) para cubrir agenda_events
    // antiguos sin subject_id que llevan el ref-code en el título
    // ("Instalación · I-2026-0007 · ..."). Sin esto los datos legacy
    // aparecían duplicados (uno en agenda_events, otro como virtual).
    const existingKey = new Set(
      events
        .filter((e) => e.subject_type && e.subject_id)
        .map((e) => `${e.subject_type}:${e.subject_id}`),
    );
    const refRegex = /\b([IM]-\d{4}-\d{4})\b/;
    const existingRefAt = new Set(
      events
        .map((e) => {
          const m = refRegex.exec(e.title);
          return m ? `${m[1]}@${e.starts_at}` : null;
        })
        .filter((k): k is string => !!k),
    );
    merged = [
      ...events,
      ...virtuals.filter((v) => {
        if (existingKey.has(`${v.subject_type}:${v.subject_id}`)) return false;
        const m = refRegex.exec(v.title);
        if (m && existingRefAt.has(`${m[1]}@${v.starts_at}`)) return false;
        return true;
      }),
    ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  const totalBeforeLimit = merged.length;
  const truncated = totalBeforeLimit > limit;
  if (truncated) merged = merged.slice(0, limit);

  await enrichTitlesFromSubjects(merged, session.company_id);
  const finalEvents = await recomputeOutsideHoursForList(merged, session.company_id);
  return {
    events: finalEvents,
    truncated,
    total_before_limit: totalBeforeLimit,
  };
}

/** Reescribe el title de los eventos cuyo subject_type sea installation
 *  o maintenance para incluir el nombre del cliente. No depende de lo
 *  guardado en agenda_events.title — siempre reconstruye desde la
 *  installation/maintenance + customer actuales. Así eventos antiguos
 *  con título "Instalación · I-2026-0007" pasan a mostrar también el
 *  cliente sin necesidad de backfill. */
async function enrichTitlesFromSubjects(
  events: AgendaItem[],
  companyId: string | null,
): Promise<void> {
  if (events.length === 0) return;
  const installationIds = new Set<string>();
  const maintenanceIds = new Set<string>();
  // Tareas manuales vinculadas directamente a un cliente o lead.
  const directCustomerIds = new Set<string>();
  const leadIds = new Set<string>();
  for (const e of events) {
    if (!e.subject_id) continue;
    if (e.subject_type === "installation") installationIds.add(e.subject_id);
    else if (e.subject_type === "maintenance") maintenanceIds.add(e.subject_id);
    else if (e.subject_type === "customer") directCustomerIds.add(e.subject_id);
    else if (e.subject_type === "lead") leadIds.add(e.subject_id);
  }
  if (
    installationIds.size === 0 &&
    maintenanceIds.size === 0 &&
    directCustomerIds.size === 0 &&
    leadIds.size === 0
  )
    return;

  // ADMIN client a propósito: solo resolvemos nombre/dirección/teléfono de los
  // subjects de tareas que el usuario YA ve (la lista de eventos se cargó con
  // RLS por su scope). Sin esto, un instalador (nivel 3) no podría leer el
  // cliente/dirección por RLS y la tarea salía sin dirección ("no sale").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  // SEGURIDAD (audit 2026-07-06): el admin client salta RLS. Acotamos SIEMPRE a la
  // empresa de la sesión para que un subject_id de otra empresa (una tarea creada
  // apuntando a un UUID ajeno) NO filtre nombre/teléfono/dirección/GPS ajenos.
  // companyId null (superadmin sin empresa concreta) => sin filtro, como antes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoped = (q: any) => (companyId ? q.eq("company_id", companyId) : q);

  type InstRow = { id: string; reference_code: string | null; customer_id: string | null };
  type MaintRow = {
    id: string;
    customer_id: string | null;
    customer_equipment_id: string | null;
  };

  const [instRes, maintRes] = await Promise.all([
    installationIds.size > 0
      ? scoped(
          supabase
            .from("installations")
            .select("id, reference_code, customer_id")
            .in("id", Array.from(installationIds)),
        )
      : Promise.resolve({ data: [] as InstRow[] }),
    maintenanceIds.size > 0
      ? scoped(
          supabase
            .from("maintenance_jobs")
            .select("id, customer_id, customer_equipment_id")
            .in("id", Array.from(maintenanceIds)),
        )
      : Promise.resolve({ data: [] as MaintRow[] }),
  ]);
  const insts = (instRes.data ?? []) as InstRow[];
  const maints = (maintRes.data ?? []) as MaintRow[];

  const custIds = new Set<string>();
  for (const i of insts) if (i.customer_id) custIds.add(i.customer_id);
  for (const m of maints) if (m.customer_id) custIds.add(m.customer_id);
  for (const id of directCustomerIds) custIds.add(id);

  const nameMap = new Map<string, string>();
  const phoneMap = new Map<string, string>();
  if (custIds.size > 0) {
    const { data: cs } = await scoped(
      supabase
        .from("customers")
        .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
        .in("id", Array.from(custIds)),
    );
    for (const c of (cs ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone_primary: string | null;
    }>) {
      nameMap.set(
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Cliente"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente",
      );
      if (c.phone_primary) phoneMap.set(c.id, c.phone_primary);
    }
  }

  // Nombres de leads vinculados directamente a una tarea.
  const leadNameMap = new Map<string, string>();
  if (leadIds.size > 0) {
    const { data: ls } = await scoped(
      supabase
        .from("leads")
        .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
        .in("id", Array.from(leadIds)),
    );
    for (const l of (ls ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone_primary: string | null;
    }>) {
      leadNameMap.set(
        l.id,
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Lead"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Lead",
      );
      if (l.phone_primary) phoneMap.set(l.id, l.phone_primary);
    }
  }

  // Direcciones (con coordenadas) de clientes y leads, para que el instalador
  // vea dónde ir y abra Google Maps desde la propia tarea sin entrar a la ficha
  // (que su rol puede no permitirle). Preferimos la principal; si no, la
  // primera. Defensivo: si falla, no rompe la agenda. Misma clave UUID para
  // clientes y leads (espacios distintos, sin colisión).
  const addrMap = new Map<
    string,
    { label: string; lat: number | null; lng: number | null }
  >();
  const addrLabel = (a: {
    street_type: string | null;
    street: string | null;
    street_number: string | null;
    city: string | null;
  }) => [a.street_type, a.street, a.street_number, a.city].filter(Boolean).join(" ").trim();
  try {
    if (custIds.size > 0) {
      const { data: ca } = await scoped(
        supabase
          .from("addresses")
          .select("customer_id, street_type, street, street_number, city, latitude, longitude, is_primary")
          .in("customer_id", Array.from(custIds))
          .is("deleted_at", null)
          .order("is_primary", { ascending: false }),
      );
      for (const a of (ca ?? []) as Array<{
        customer_id: string;
        street_type: string | null;
        street: string | null;
        street_number: string | null;
        city: string | null;
        latitude: number | null;
        longitude: number | null;
      }>) {
        if (!a.customer_id || addrMap.has(a.customer_id)) continue;
        addrMap.set(a.customer_id, { label: addrLabel(a), lat: a.latitude, lng: a.longitude });
      }
    }
    if (leadIds.size > 0) {
      const { data: la } = await scoped(
        supabase
          .from("addresses")
          .select("lead_id, street_type, street, street_number, city, latitude, longitude, is_primary")
          .in("lead_id", Array.from(leadIds))
          .is("deleted_at", null)
          .order("is_primary", { ascending: false }),
      );
      for (const a of (la ?? []) as Array<{
        lead_id: string;
        street_type: string | null;
        street: string | null;
        street_number: string | null;
        city: string | null;
        latitude: number | null;
        longitude: number | null;
      }>) {
        if (!a.lead_id || addrMap.has(a.lead_id)) continue;
        addrMap.set(a.lead_id, { label: addrLabel(a), lat: a.latitude, lng: a.longitude });
      }
    }
  } catch (e) {
    console.error("[enrichTitlesFromSubjects] direcciones:", e);
  }

  // Dirección CONCRETA de cada mantenimiento (un cliente puede tener equipos en
  // direcciones distintas). Prioridad al leer: job.address_id → equipo.address_id
  // → (fallback) principal del cliente. Beneficia también a mantenimientos
  // creados ANTES de esta mejora (resuelven por la dirección del equipo).
  const addrById = new Map<
    string,
    { label: string; lat: number | null; lng: number | null }
  >();
  const eqAddrMap = new Map<string, string>(); // customer_equipment_id → address_id
  const maintAddrId = new Map<string, string>(); // maintenance_job_id → address_id
  try {
    if (maints.length > 0) {
      // address_id de cada job (defensivo: la columna es nueva).
      try {
        const { data: mAddr } = await scoped(
          supabase
            .from("maintenance_jobs")
            .select("id, address_id")
            .in(
              "id",
              maints.map((m) => m.id),
            ),
        );
        for (const r of (mAddr ?? []) as Array<{ id: string; address_id: string | null }>) {
          if (r.address_id) maintAddrId.set(r.id, r.address_id);
        }
      } catch {
        /* columna address_id aún no disponible: caemos a equipo/principal */
      }
    }
    // address_id de cada equipo referenciado por los jobs.
    const eqIds = Array.from(
      new Set(maints.map((m) => m.customer_equipment_id).filter(Boolean)),
    ) as string[];
    if (eqIds.length > 0) {
      const { data: eqRows } = await scoped(
        supabase
          .from("customer_equipment")
          .select("id, address_id")
          .in("id", eqIds),
      );
      for (const r of (eqRows ?? []) as Array<{ id: string; address_id: string | null }>) {
        if (r.address_id) eqAddrMap.set(r.id, r.address_id);
      }
    }
    // Cargar las direcciones concretas necesarias (por id) con coordenadas.
    const specificIds = Array.from(new Set([...maintAddrId.values(), ...eqAddrMap.values()]));
    if (specificIds.length > 0) {
      const { data: aRows } = await scoped(
        supabase
          .from("addresses")
          .select("id, street_type, street, street_number, city, latitude, longitude")
          .in("id", specificIds)
          .is("deleted_at", null),
      );
      for (const a of (aRows ?? []) as Array<{
        id: string;
        street_type: string | null;
        street: string | null;
        street_number: string | null;
        city: string | null;
        latitude: number | null;
        longitude: number | null;
      }>) {
        addrById.set(a.id, { label: addrLabel(a), lat: a.latitude, lng: a.longitude });
      }
    }
  } catch (e) {
    console.error("[enrichTitlesFromSubjects] dirección de equipo:", e);
  }

  const instById = new Map(insts.map((i) => [i.id, i]));
  const maintById = new Map(maints.map((m) => [m.id, m]));

  function applyContact(e: AgendaItem, ownerId: string | null | undefined): void {
    if (!ownerId) return;
    const ph = phoneMap.get(ownerId);
    if (ph) e.subject_phone = ph;
    const ad = addrMap.get(ownerId);
    if (ad) {
      e.subject_address = ad.label || null;
      e.subject_lat = ad.lat;
      e.subject_lng = ad.lng;
    }
  }

  for (const e of events) {
    if (!e.subject_id) continue;
    if (e.subject_type === "installation") {
      const i = instById.get(e.subject_id);
      if (!i) continue;
      const cust = i.customer_id ? nameMap.get(i.customer_id) : null;
      const ref = i.reference_code;
      if (ref && cust) e.title = `Instalación · ${ref} · ${cust}`;
      else if (ref) e.title = `Instalación · ${ref}`;
      else if (cust) e.title = `Instalación · ${cust}`;
      if (cust) e.subject_label = cust;
      applyContact(e, i.customer_id);
    } else if (e.subject_type === "maintenance") {
      const m = maintById.get(e.subject_id);
      if (!m) continue;
      const cust = m.customer_id ? nameMap.get(m.customer_id) : null;
      if (cust) {
        e.title = `Mantenimiento · ${cust}`;
        e.subject_label = cust;
      }
      // Dirección concreta del trabajo: la fijada en el job, o la del equipo;
      // si no hay, caemos a la principal del cliente (applyContact).
      const directAddrId = maintAddrId.get(m.id);
      let specific = directAddrId ? addrById.get(directAddrId) : undefined;
      if (!specific && m.customer_equipment_id) {
        const eqAddrId = eqAddrMap.get(m.customer_equipment_id);
        if (eqAddrId) specific = addrById.get(eqAddrId);
      }
      if (specific) {
        e.subject_address = specific.label || null;
        e.subject_lat = specific.lat;
        e.subject_lng = specific.lng;
        const ph = m.customer_id ? phoneMap.get(m.customer_id) : null;
        if (ph) e.subject_phone = ph;
      } else {
        applyContact(e, m.customer_id);
      }
    } else if (e.subject_type === "customer") {
      // Tarea manual vinculada a un cliente: conservamos el título que
      // escribió el usuario y añadimos el nombre del cliente.
      const cust = nameMap.get(e.subject_id);
      if (cust) {
        e.subject_label = cust;
        if (!e.title.includes(cust)) e.title = `${e.title} · ${cust}`;
      }
      applyContact(e, e.subject_id);
    } else if (e.subject_type === "lead") {
      const lead = leadNameMap.get(e.subject_id);
      if (lead) {
        e.subject_label = lead;
        if (!e.title.includes(lead)) e.title = `${e.title} · ${lead}`;
      }
      applyContact(e, e.subject_id);
    }
  }
}

/**
 * Lee instalaciones + mantenimientos programados en el rango y los devuelve
 * como AgendaItem virtuales (sin row en agenda_events). Esto evita que
 * trabajos del campo se pierdan si la inserción defensiva en agenda_events
 * falló en su momento (bug 2026-05-11).
 */
async function loadVirtualAgendaItems(args: {
  from: string;
  to: string;
  restrictToUserId: string | null;
  companyId: string | null;
}): Promise<AgendaItem[]> {
  if (!args.companyId) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Defensa: cap por query para evitar pesos de DOM en empresas con muchos
  // mantenimientos. El listAgendaRangeFull aplica además un cap global tras
  // el merge, este es solo para no traer 5000 filas de BD por query.
  const PER_QUERY_CAP = 1000;

  let instQ = supabase
    .from("installations")
    .select(
      "id, reference_code, customer_id, status, scheduled_at, installer_user_id, kind",
    )
    .eq("company_id", args.companyId)
    .in("status", ["scheduled", "in_progress", "paused"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", args.from)
    .lte("scheduled_at", args.to)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(PER_QUERY_CAP);
  if (args.restrictToUserId) {
    instQ = instQ.eq("installer_user_id", args.restrictToUserId);
  }

  let maintQ = supabase
    .from("maintenance_jobs")
    .select("id, customer_id, status, scheduled_at, technician_user_id")
    .eq("company_id", args.companyId)
    .in("status", ["scheduled", "in_progress"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", args.from)
    .lte("scheduled_at", args.to)
    .order("scheduled_at", { ascending: true })
    .limit(PER_QUERY_CAP);
  if (args.restrictToUserId) {
    maintQ = maintQ.eq("technician_user_id", args.restrictToUserId);
  }

  const [{ data: insts }, { data: maints }] = await Promise.all([instQ, maintQ]);
  type InstRow = {
    id: string;
    reference_code: string | null;
    customer_id: string | null;
    status: string;
    scheduled_at: string;
    installer_user_id: string | null;
    kind: "normal" | "free_trial" | "relocation" | "uninstall" | null;
  };
  type MaintRow = {
    id: string;
    customer_id: string | null;
    status: string;
    scheduled_at: string;
    technician_user_id: string | null;
  };
  const instList = (insts ?? []) as InstRow[];
  const maintList = (maints ?? []) as MaintRow[];

  // Resolver nombres de cliente para títulos
  const cIds = Array.from(
    new Set(
      [...instList.map((i) => i.customer_id), ...maintList.map((m) => m.customer_id)].filter(
        (v): v is string => !!v,
      ),
    ),
  );
  const nameMap = new Map<string, string>();
  if (cIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", cIds);
    for (const c of (cs ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      nameMap.set(
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Cliente"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente",
      );
    }
  }

  const out: AgendaItem[] = [];
  for (const i of instList) {
    const custName = i.customer_id ? nameMap.get(i.customer_id) : null;
    const ref = i.reference_code;
    // Distinguir desinstalación (retirada) y reubicación de la instalación normal.
    const isUninstall = i.kind === "uninstall";
    const noun = isUninstall
      ? "Desinstalación"
      : i.kind === "relocation"
        ? "Reubicación"
        : "Instalación";
    // Título: "{tipo} · {ref} · {cliente}" si tenemos ambos.
    let title: string;
    if (ref && custName) title = `${noun} · ${ref} · ${custName}`;
    else if (ref) title = `${noun} · ${ref}`;
    else if (custName) title = `${noun} · ${custName}`;
    else title = noun;
    out.push({
      id: `virtual-inst-${i.id}`,
      // kind 'uninstall' para que el calendario lo pinte distinto (RETIRADA).
      kind: isUninstall ? "uninstall" : "installation",
      status: i.status,
      title,
      description: ref ?? null,
      starts_at: i.scheduled_at,
      ends_at: null,
      assigned_user_id: i.installer_user_id,
      is_outside_hours: false,
      subject_type: "installation",
      subject_id: i.id,
    });
  }
  for (const m of maintList) {
    out.push({
      id: `virtual-maint-${m.id}`,
      kind: "maintenance",
      status: m.status,
      title: m.customer_id
        ? `Mantenimiento · ${nameMap.get(m.customer_id) ?? "Cliente"}`
        : "Mantenimiento",
      description: null,
      starts_at: m.scheduled_at,
      ends_at: null,
      assigned_user_id: m.technician_user_id,
      is_outside_hours: false,
      subject_type: "maintenance",
      subject_id: m.id,
    });
  }
  return out;
}

/**
 * Recalcula is_outside_hours para una lista de eventos. Esto evita que
 * los eventos guardados con la lógica antigua (hardcoded 9-18 o sólo
 * business_hours sin user_work_schedules) se vean mal en el listado.
 *
 * Hace UNA query a user_work_schedules por usuario único y UNA a
 * company_settings.business_hours, así que es eficiente.
 */
async function recomputeOutsideHoursForList(
  events: AgendaItem[],
  companyId: string | null,
): Promise<AgendaItem[]> {
  if (!companyId || events.length === 0) return events;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cargar todos los user_work_schedules de los usuarios asignados
  const userIds = Array.from(
    new Set(events.map((e) => e.assigned_user_id).filter((x): x is string => Boolean(x))),
  );
  type Sched = { user_id: string; day_of_week: number; starts_at: string | null; ends_at: string | null };
  let schedRows: Sched[] = [];
  if (userIds.length > 0) {
    const { data } = await admin
      .from("user_work_schedules")
      .select("user_id, day_of_week, starts_at, ends_at")
      .in("user_id", userIds);
    schedRows = (data ?? []) as Sched[];
  }
  const schedMap = new Map<string, Sched>();
  for (const s of schedRows) {
    schedMap.set(`${s.user_id}-${s.day_of_week}`, s);
  }

  // Cargar business_hours de la empresa (fallback)
  let bh: Record<string, { open: string; close: string } | null> | null = null;
  try {
    const { data: cs } = await admin
      .from("company_settings")
      .select("business_hours")
      .eq("company_id", companyId)
      .maybeSingle();
    bh = (cs as { business_hours: typeof bh } | null)?.business_hours ?? null;
  } catch {
    /* no-op */
  }

  return events.map((ev) => {
    const d = new Date(ev.starts_at);
    let outside = false;
    let resolved = false;
    // 1) horario del usuario (día de la semana en hora Madrid)
    if (ev.assigned_user_id) {
      const isoDow = madridIsoDow(d);
      const sched = schedMap.get(`${ev.assigned_user_id}-${isoDow}`);
      if (sched) {
        if (sched.starts_at && sched.ends_at) {
          outside = !inTimeRange(d, sched.starts_at, sched.ends_at);
        } else {
          outside = true; // día libre del usuario
        }
        resolved = true;
      }
    }
    // 2) horario corporativo
    if (!resolved && bh) {
      const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
      const slot = (bh as Record<string, { open: string; close: string } | null>)[
        KEYS[madridJsDay(d)]!
      ];
      if (!slot) {
        outside = true;
      } else {
        outside = !inTimeRange(d, slot.open, slot.close);
      }
      resolved = true;
    }
    // 3) fallback 9-18 lun-vie (en hora Madrid)
    if (!resolved) {
      const day = madridJsDay(d);
      const hour = madridHour(d);
      outside = day === 0 || day === 6 || hour < 9 || hour > 18;
    }
    return { ...ev, is_outside_hours: outside };
  });
}

export interface AgendaSubjectHit {
  subject_type: "customer" | "lead";
  subject_id: string;
  label: string;
  sublabel: string | null;
}

/**
 * Busca clientes y leads por nombre/teléfono para vincularlos a una tarea
 * de la agenda. Usa el cliente con RLS (createClient), así que el
 * aislamiento por empresa y el scope por rol los aplica la base de datos.
 * Devuelve como mucho ~16 resultados (8 clientes + 8 leads).
 */
export async function searchAgendaSubjectsAction(
  query: string,
): Promise<AgendaSubjectHit[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const q = (query || "").trim();
  if (q.length < 2) return [];
  // Saneamos caracteres que tienen significado en el filtro .or() de
  // PostgREST (comodines % _, separador de coma, paréntesis de grupo).
  const safe = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  if (!safe) return [];
  const like = `%${safe}%`;
  const orFilter = [
    `legal_name.ilike.${like}`,
    `trade_name.ilike.${like}`,
    `first_name.ilike.${like}`,
    `last_name.ilike.${like}`,
    `phone_primary.ilike.${like}`,
  ].join(",");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  type Row = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_primary: string | null;
  };
  const cols = "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary";

  const [custRes, leadRes] = await Promise.all([
    supabase
      .from("customers")
      .select(cols)
      .is("deleted_at", null)
      .or(orFilter)
      .limit(8),
    supabase
      .from("leads")
      .select(cols)
      .is("deleted_at", null)
      .neq("status", "converted")
      .or(orFilter)
      .limit(8),
  ]);

  const nameOf = (r: Row) =>
    r.party_kind === "company"
      ? r.trade_name || r.legal_name || "Sin nombre"
      : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Sin nombre";

  const hits: AgendaSubjectHit[] = [];
  for (const r of (custRes.data ?? []) as Row[]) {
    hits.push({
      subject_type: "customer",
      subject_id: r.id,
      label: nameOf(r),
      sublabel: r.phone_primary,
    });
  }
  for (const r of (leadRes.data ?? []) as Row[]) {
    hits.push({
      subject_type: "lead",
      subject_id: r.id,
      label: nameOf(r),
      sublabel: r.phone_primary,
    });
  }
  return hits;
}

export interface AgendaSubjectPage {
  items: AgendaSubjectHit[];
  hasMore: boolean;
}

/**
 * Lista clientes O leads para el MODAL-buscador de la agenda. A diferencia de
 * searchAgendaSubjectsAction (typeahead que obliga a escribir el nombre), esta
 * permite NAVEGAR la lista completa (query vacía) y paginar de 50 en 50 — útil
 * cuando no recuerdas el nombre y tienes miles de clientes. Filtra por tipo.
 * RLS (createClient) acota a la empresa y al scope por rol.
 */
export async function listAgendaSubjectsAction(input: {
  type: "customer" | "lead";
  query?: string;
  offset?: number;
}): Promise<AgendaSubjectPage> {
  const session = await requireSession();
  if (!session.company_id) return { items: [], hasMore: false };
  const PAGE = 50;
  const offset = Math.max(0, input.offset ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const cols =
    "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary";
  let q = supabase
    .from(input.type === "customer" ? "customers" : "leads")
    .select(cols)
    .is("deleted_at", null);
  if (input.type === "lead") q = q.neq("status", "converted");
  const raw = (input.query ?? "").trim();
  if (raw.length >= 1) {
    const safe = raw.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
    if (safe) {
      const like = `%${safe}%`;
      q = q.or(
        [
          `legal_name.ilike.${like}`,
          `trade_name.ilike.${like}`,
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `phone_primary.ilike.${like}`,
        ].join(","),
      );
    }
  }
  // Pedimos PAGE+1 (range inclusivo) para saber si hay más sin un count aparte.
  q = q
    .order("legal_name", { ascending: true, nullsFirst: false })
    .order("last_name", { ascending: true, nullsFirst: false })
    .order("first_name", { ascending: true, nullsFirst: false })
    .range(offset, offset + PAGE);
  const { data } = await q;
  type Row = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_primary: string | null;
  };
  const rows = (data ?? []) as Row[];
  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const nameOf = (r: Row) =>
    r.party_kind === "company"
      ? r.trade_name || r.legal_name || "Sin nombre"
      : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Sin nombre";
  const items: AgendaSubjectHit[] = page.map((r) => ({
    subject_type: input.type,
    subject_id: r.id,
    label: nameOf(r),
    sublabel: r.phone_primary,
  }));
  return { items, hasMore };
}

/**
 * Devuelve la lista de miembros para los selectores de "asignar a" /
 * "ver agenda de". Aplica las reglas de scope:
 *  - Nivel 1 (company_admin) o superadmin → ve a todos los miembros.
 *  - Nivel 2 (directores) → ve a los miembros de su departamento.
 *  - Nivel 3 (sales_rep, telemarketer, installer) → solo se ve a sí
 *    mismo (no debe ver al admin u otros usuarios).
 */
export async function listTeamMembers(): Promise<{ user_id: string; full_name: string }[]> {
  const session = await requireSession();
  if (!session.company_id) return [];

  const isLevel1 =
    session.is_superadmin || session.roles.includes("company_admin");
  const isLevel2 =
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Nivel 3: solo a sí mismo
  if (!isLevel1 && !isLevel2) {
    const { data } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .eq("company_id", session.company_id)
      .eq("user_id", session.user_id)
      .maybeSingle();
    if (!data) return [];
    return [data as { user_id: string; full_name: string }];
  }

  // Nivel 1: todos
  if (isLevel1) {
    const { data } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .eq("company_id", session.company_id)
      .order("full_name");
    return (data ?? []) as { user_id: string; full_name: string }[];
  }

  // Nivel 2: su departamento. Resolvemos via team_assignments donde el
  // director es manager_user_id; los miembros son member_user_id.
  // Fallback: si no hay assignments, devolvemos el propio director.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = (await createAdminClient()) as any;
  let memberIds: string[] = [session.user_id];
  try {
    const { data: assignments } = await admin
      .from("team_assignments")
      .select("member_user_id")
      .eq("company_id", session.company_id)
      .eq("manager_user_id", session.user_id)
      .is("revoked_at", null);
    type TA = { member_user_id: string };
    const ids = ((assignments ?? []) as TA[]).map((a) => a.member_user_id);
    memberIds = Array.from(new Set([session.user_id, ...ids]));
  } catch {
    /* fail-soft: solo se ve a sí mismo */
  }
  const { data } = await supabase
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .in("user_id", memberIds)
    .order("full_name");
  return (data ?? []) as { user_id: string; full_name: string }[];
}

/**
 * Lista usuarios capaces de hacer instalaciones:
 * `installer`, `technical_director` o `company_admin` (admin puede
 * asignarse a sí mismo o cubrir si todavía no hay instaladores).
 * Excluye comerciales, telemarketers, directores comerciales puros.
 */
export async function listInstallers(): Promise<{ user_id: string; full_name: string }[]> {
  const session = await requireSession();
  if (!session.company_id) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = (await createAdminClient()) as any;
  // Roles que pueden instalar
  const validRoles = ["installer", "technical_director", "company_admin"];
  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .in("role_key", validRoles)
    .is("revoked_at", null);
  let ids = Array.from(
    new Set(((roles as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)),
  );

  // Fallback: si NO hay nadie con esos roles (estado inicial sin
  // configurar), incluir al usuario actual si es nivel 1/2 técnico
  // para que pueda asignarse manualmente y desbloquear el listado.
  if (ids.length === 0) {
    if (
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director")
    ) {
      ids = [session.user_id];
    } else {
      return [];
    }
  }

  const { data } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .in("user_id", ids)
    .order("full_name");
  return ((data as { user_id: string; full_name: string }[] | null) ?? []);
}

/**
 * Usuarios elegibles para asignárseles una furgoneta.
 *
 * Decisión usuario 2026-05-09: incluye admin, director técnico,
 * instalador, director comercial y comercial (porque a veces llevan
 * piezas pequeñas al cliente). EXCLUYE telemarketer y director TMK.
 */
export async function listVanCandidates(): Promise<{ user_id: string; full_name: string }[]> {
  const session = await requireSession();
  if (!session.company_id) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = (await createAdminClient()) as any;
  const validRoles = [
    "company_admin",
    "technical_director",
    "installer",
    "commercial_director",
    "sales_rep",
  ];
  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("company_id", session.company_id)
    .in("role_key", validRoles)
    .is("revoked_at", null);
  const ids = Array.from(
    new Set(((roles as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)),
  );
  if (ids.length === 0) return [];

  const { data } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .in("user_id", ids)
    .order("full_name");
  return ((data as { user_id: string; full_name: string }[] | null) ?? []);
}

export async function createAgendaEventAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(agendaCreateSchema, input, "Agenda");

  // Calcular fechas de la serie según recurrencia. Las fechas vienen de un
  // <input type="datetime-local"> = hora de pared de Madrid. Las convertimos al
  // instante UTC correcto (si no, el servidor UTC las guarda 1-2 h adelantadas).
  const startIso = madridLocalToUtcISO(parsed.starts_at);
  if (!startIso) throw new Error("Fecha de inicio inválida");

  // MANTENIMIENTO: una tarea de tipo "maintenance" es un mantenimiento REAL, no
  // una tarea suelta de agenda. Creamos un maintenance_job (aparece en
  // /mantenimientos y lo ve el instalador asignado) en vez de un agenda_event;
  // la agenda ya muestra los mantenimientos como tareas, así que no se duplica.
  // Exige cliente (la tabla maintenance_jobs requiere customer_id).
  if (parsed.kind === "maintenance") {
    if (parsed.subject_type !== "customer" || !parsed.subject_id) {
      throw new Error(
        "Para agendar un mantenimiento elige un CLIENTE. Si es un lead (cliente nuevo), conviértelo a cliente primero.",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminM = createAdminClient() as any;
    // Verificar que el cliente es de la empresa (subject_id llega del navegador).
    const { data: cust } = await adminM
      .from("customers")
      .select("id")
      .eq("id", parsed.subject_id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cust) throw new Error("Cliente no encontrado o no pertenece a tu empresa");

    // Equipo concreto (opcional): verificamos que es de ESTE cliente y empresa
    // (subject_equipment_id llega del navegador). Si no cuadra, se ignora.
    let equipmentId: string | null = null;
    let eqAddressId: string | null = null;
    if (parsed.subject_equipment_id) {
      const { data: eq } = await adminM
        .from("customer_equipment")
        .select("id, address_id, customer_id, company_id")
        .eq("id", parsed.subject_equipment_id)
        .maybeSingle();
      const e = eq as
        | { id: string; address_id: string | null; customer_id: string; company_id: string }
        | null;
      if (e && e.company_id === session.company_id && e.customer_id === parsed.subject_id) {
        equipmentId = e.id;
        eqAddressId = e.address_id;
      }
    }

    // Dirección: la elegida a mano (validada del mismo cliente) o, por defecto,
    // la del equipo. NULL => se resuelve al leer (principal del cliente).
    let addressId: string | null = null;
    if (parsed.subject_address_id) {
      const { data: ad } = await adminM
        .from("addresses")
        .select("id, customer_id, company_id")
        .eq("id", parsed.subject_address_id)
        .maybeSingle();
      const a = ad as
        | { id: string; customer_id: string | null; company_id: string }
        | null;
      if (a && a.company_id === session.company_id && a.customer_id === parsed.subject_id) {
        addressId = a.id;
      }
    }
    if (!addressId) addressId = eqAddressId;

    const maintNotes =
      [parsed.title, parsed.description].filter(Boolean).join(" — ") || null;
    const mPayload: Record<string, unknown> = {
      company_id: session.company_id,
      customer_id: parsed.subject_id,
      customer_equipment_id: equipmentId,
      address_id: addressId,
      kind: "one_off", // correctivo / puntual desde la agenda
      status: "scheduled",
      scheduled_at: startIso,
      technician_user_id: parsed.assigned_user_id || session.user_id,
      notes: maintNotes,
      created_by: session.user_id,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mErr: any = null;
    {
      const r = await adminM.from("maintenance_jobs").insert(mPayload);
      mErr = r.error;
    }
    // Defensa: si address_id aún no está en el cache del esquema, reintentar sin
    // ella (no bloquear el alta por la migración).
    if (mErr && /address_id|schema cache|Could not find/i.test(mErr.message ?? "")) {
      delete mPayload.address_id;
      const r = await adminM.from("maintenance_jobs").insert(mPayload);
      mErr = r.error;
    }
    if (mErr) throw new Error(mErr.message);
    revalidatePath("/mantenimientos");
    revalidatePath("/agenda");
    return;
  }

  const baseStart = new Date(startIso);
  const endIso = parsed.ends_at ? madridLocalToUtcISO(parsed.ends_at) : null;
  const baseEnd = endIso ? new Date(endIso) : null;
  const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;
  const occurrences =
    parsed.recurrence_freq === "none" ? 1 : Math.max(1, parsed.recurrence_count);

  function bumpDate(d: Date, i: number): Date {
    const r = new Date(d);
    if (parsed.recurrence_freq === "daily") r.setDate(r.getDate() + i);
    else if (parsed.recurrence_freq === "weekly") r.setDate(r.getDate() + i * 7);
    else if (parsed.recurrence_freq === "monthly") r.setMonth(r.getMonth() + i);
    return r;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Determinar usuario asignado para usar SU horario (user_work_schedules)
  const assignedUserId = parsed.assigned_user_id || session.user_id;

  const rows = [];
  for (let i = 0; i < occurrences; i++) {
    const s = bumpDate(baseStart, i);
    const e = baseEnd ? new Date(s.getTime() + durationMs) : null;
    const isOutsideHours = await computeIsOutsideHours(
      s,
      session.company_id,
      assignedUserId,
    );
    rows.push({
      company_id: session.company_id,
      kind: parsed.kind,
      title: parsed.title,
      description: parsed.description || null,
      starts_at: s.toISOString(),
      ends_at: e ? e.toISOString() : null,
      all_day: parsed.all_day,
      assigned_user_id: parsed.assigned_user_id || session.user_id,
      subject_type: parsed.subject_type || null,
      subject_id: parsed.subject_id || null,
      is_outside_hours: isOutsideHours,
      reminders_min_before: parsed.reminders_min_before,
      created_by: session.user_id,
    });
  }
  // Admin client: la policy agenda_events_insert por scope puede
  // bloquear si el usuario no es nivel 1-2. Como ya validamos sesión
  // y el assigned_user_id se establece arriba, es seguro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin.from("agenda_events").insert(rows);
  if (error) {
    console.error("[createAgendaEvents] insert failed:", error.message);
    throw new Error(error.message);
  }
  revalidatePath("/agenda");
}

/**
 * Reagenda un evento a otra fecha conservando la hora original (o el mismo día
 * con nueva hora). Ajusta is_outside_hours según horario comercial. Marca
 * status='rescheduled' si pasa de scheduled a otra fecha.
 */
/**
 * Versión result pattern (decisión 2026-05-20): los errores se devuelven
 * como { ok:false, error } en lugar de throw para que Next.js NO los
 * redacte con digest en producción. Los callers cliente leen result.error
 * y lo muestran al usuario tal cual.
 *
 * Mantenemos la versión `rescheduleAgendaEventAction` (sin Safe) como
 * wrapper que sigue lanzando — para compatibilidad con cualquier caller
 * que aún no se haya migrado.
 */
export async function rescheduleAgendaEventSafeAction(
  eventId: string,
  newStartsAtIso: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await rescheduleAgendaEventInternal(eventId, newStartsAtIso);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function rescheduleAgendaEventAction(
  eventId: string,
  newStartsAtIso: string,
): Promise<void> {
  await rescheduleAgendaEventInternal(eventId, newStartsAtIso);
}

async function rescheduleAgendaEventInternal(
  eventId: string,
  newStartsAtIso: string,
): Promise<void> {
  // La nueva hora puede llegar como hora de pared de Madrid (datetime-local del
  // diálogo de mover) o como ISO con zona (arrastre en el calendario). La
  // normalizamos al instante UTC correcto (idempotente si ya trae zona) para
  // no guardarla 1-2 h adelantada.
  newStartsAtIso = madridLocalToUtcISO(newStartsAtIso) ?? newStartsAtIso;
  // Validación: la nueva fecha no puede estar en el pasado.
  const _newDt = new Date(newStartsAtIso);
  if (!isNaN(_newDt.getTime()) && _newDt.getTime() < Date.now() - 60 * 1000) {
    throw new Error(
      "No puedes reagendar a una fecha/hora pasada. Elige un momento futuro.",
    );
  }
  // Items VIRTUALES (instalaciones / mantenimientos directos) tienen
  // id "virtual-inst-{uuid}" o "virtual-maint-{uuid}". No están en
  // agenda_events; reagendamos directamente la tabla origen.
  if (eventId.startsWith("virtual-inst-")) {
    const realId = eventId.slice("virtual-inst-".length);
    await rescheduleInstallationFromAgenda(realId, newStartsAtIso);
    return;
  }
  if (eventId.startsWith("virtual-maint-")) {
    const realId = eventId.slice("virtual-maint-".length);
    await rescheduleMaintenanceFromAgenda(realId, newStartsAtIso);
    return;
  }

  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const newStart = new Date(newStartsAtIso);
  // Cargar el usuario asignado actual del evento para calcular is_outside
  // según SU horario (no el de empresa, ni el del actor que reagenda).
  const { data: prevAssign } = await supabase
    .from("agenda_events")
    .select("assigned_user_id")
    .eq("id", eventId)
    .maybeSingle();
  const assignedUserId =
    (prevAssign as { assigned_user_id: string | null } | null)?.assigned_user_id ?? null;
  const isOutsideHours = await computeIsOutsideHours(
    newStart,
    session.company_id,
    assignedUserId,
  );

  const { data: prev } = await supabase
    .from("agenda_events")
    .select("starts_at, ends_at, status")
    .eq("id", eventId)
    .maybeSingle();
  type Prev = { starts_at: string; ends_at: string | null; status: string };
  const p = prev as Prev | null;
  // SEGURIDAD: `supabase` aplica RLS, así que un evento de otra empresa
  // devuelve null aquí. Abortamos para que el UPDATE admin de abajo (que
  // salta RLS) no pueda mover eventos ajenos pasando su UUID.
  if (!p) throw new Error("Evento de agenda no encontrado o no pertenece a tu empresa");

  // Calcular nueva ends_at preservando la duración
  let newEndsAt: string | null = null;
  if (p?.ends_at) {
    const oldStart = new Date(p.starts_at).getTime();
    const oldEnd = new Date(p.ends_at).getTime();
    const durationMs = oldEnd - oldStart;
    newEndsAt = new Date(newStart.getTime() + durationMs).toISOString();
  }

  // Conflict check: lo guardamos para registrarlo después de declarar admin.
  let overlappingEventId: string | null = null;
  if (assignedUserId) {
    try {
      const newEndIso = newEndsAt ?? new Date(newStart.getTime() + 3600000).toISOString();
      const { data: overlap } = await supabase
        .from("agenda_events")
        .select("id, title, starts_at")
        .eq("assigned_user_id", assignedUserId)
        .neq("id", eventId)
        .lt("starts_at", newEndIso)
        .gt("ends_at", newStart.toISOString())
        .not("status", "in", "(cancelled,completed)")
        .limit(1);
      if (overlap && (overlap as Array<{ id: string }>).length > 0) {
        overlappingEventId = (overlap as Array<{ id: string }>)[0]!.id;
      }
    } catch {
      /* fail-soft */
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("agenda_events")
    .update({
      starts_at: newStart.toISOString(),
      ends_at: newEndsAt,
      is_outside_hours: isOutsideHours,
      ...(p?.status === "scheduled" ? {} : {}),
    })
    .eq("id", eventId)
    .eq("company_id", session.company_id);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "user",
    subject_id: session.user_id,
    kind: "agenda.rescheduled",
    payload: { event_id: eventId, from: p?.starts_at, to: newStart.toISOString() },
    actor_user_id: session.user_id,
  });

  // Si detectamos solape, registramos warning para que el admin lo vea
  if (overlappingEventId) {
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "agenda",
        subject_id: eventId,
        kind: "agenda.conflict_warning",
        payload: {
          assigned_user_id: assignedUserId,
          overlapping_event_id: overlappingEventId,
          new_starts_at: newStart.toISOString(),
        },
        actor_user_id: session.user_id,
      });
    } catch {
      /* */
    }
  }

  revalidatePath("/agenda");
}

export async function updateAgendaStatus(
  id: string,
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show" | "rescheduled",
) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtramos por company_id para que
  // no se pueda cambiar el estado de eventos de otra empresa con su UUID.
  const { data, error } = await admin
    .from("agenda_events")
    .update({ status })
    .eq("id", id)
    .eq("company_id", session.company_id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Evento no encontrado o no pertenece a tu empresa");
  revalidatePath("/agenda");
}

/**
 * Versión "result pattern" para uso desde UI cliente sin perder mensajes
 * en producción. Acepta tanto eventos reales como virtuales (instalación
 * o mantenimiento) — en virtuales delega a markInstallationCompleted o
 * a updateMaintenanceStatus de su módulo.
 */
export async function markAgendaEventDoneAction(
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (eventId.startsWith("virtual-inst-") || eventId.startsWith("virtual-maint-")) {
      // Eventos virtuales: el "marcar hecho" desde agenda no aplica
      // directamente (la instalación se cierra desde su wizard). Solo
      // marcamos cancelado si el usuario insiste.
      return {
        ok: false,
        error:
          "Las instalaciones y mantenimientos se cierran desde su propia ficha, no desde la agenda.",
      };
    }
    await updateAgendaStatus(eventId, "completed");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Reasigna una tarea de agenda a otro usuario. Sólo nivel 1 / nivel 2.
 * Recalcula is_outside_hours con el horario del nuevo asignado.
 * Notifica al nuevo asignado.
 */
export async function reassignAgendaEventAction(
  eventId: string,
  newUserId: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // Items virtuales: reasignar la tabla origen (installations.installer_user_id
  // o maintenance_jobs.technician_user_id) en vez de agenda_events.
  const isUpperEarly =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpperEarly && eventId.startsWith("virtual-")) {
    throw new Error("Solo nivel 1 o 2 puede reasignar tareas");
  }
  if (eventId.startsWith("virtual-inst-")) {
    const realId = eventId.slice("virtual-inst-".length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin2 = createAdminClient() as any;
    await admin2
      .from("installations")
      .update({
        installer_user_id: newUserId || null,
        assigned_at: newUserId ? new Date().toISOString() : null,
        assigned_by: newUserId ? session.user_id : null,
      })
      .eq("id", realId)
      .eq("company_id", session.company_id);
    revalidatePath("/agenda");
    revalidatePath(`/instalaciones/${realId}`);
    return;
  }
  if (eventId.startsWith("virtual-maint-")) {
    const realId = eventId.slice("virtual-maint-".length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin2 = createAdminClient() as any;
    await admin2
      .from("maintenance_jobs")
      .update({ technician_user_id: newUserId || null })
      .eq("id", realId)
      .eq("company_id", session.company_id);
    revalidatePath("/agenda");
    revalidatePath(`/mantenimientos/${realId}`);
    return;
  }
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo nivel 1 o 2 puede reasignar tareas");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin client salta RLS → filtramos por company_id.
  const { data: ev } = await admin
    .from("agenda_events")
    .select("starts_at, title")
    .eq("id", eventId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const e = ev as { starts_at: string; title: string } | null;
  if (!e) throw new Error("Evento no encontrado o no pertenece a tu empresa");

  const newOutside = await computeIsOutsideHours(
    new Date(e.starts_at),
    session.company_id,
    newUserId,
  );

  const r = await admin
    .from("agenda_events")
    .update({
      assigned_user_id: newUserId,
      is_outside_hours: newOutside,
    })
    .eq("id", eventId)
    .eq("company_id", session.company_id);
  if (r.error) throw new Error(r.error.message);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "user",
    subject_id: newUserId,
    kind: "agenda.reassigned",
    payload: { event_id: eventId, from: session.user_id, to: newUserId },
    actor_user_id: session.user_id,
  });

  // Notify
  try {
    const { notify } = await import("@/modules/notifications/notifier");
    await notify({
      company_id: session.company_id,
      recipient_user_id: newUserId,
      kind: "agenda.assigned",
      severity: "info",
      title: "Tarea asignada",
      body: e.title,
      action_url: "/agenda",
    });
  } catch {
    /* no-op */
  }

  revalidatePath("/agenda");
}

// ============================================================================
// Reschedule de items virtuales (instalaciones / mantenimientos) desde la
// agenda. La agenda los muestra como AgendaItem con id "virtual-inst-..."
// o "virtual-maint-..."; al arrastrar, llamamos aquí para actualizar la
// tabla origen.
// ============================================================================

async function rescheduleInstallationFromAgenda(
  installationId: string,
  newStartsAtIso: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prev } = await admin
    .from("installations")
    .select("status, company_id")
    .eq("id", installationId)
    .maybeSingle();
  if (!prev) throw new Error("Instalación no encontrada");
  if ((prev as { company_id: string }).company_id !== session.company_id) {
    throw new Error("Instalación de otra empresa");
  }
  if (
    !["scheduled", "in_progress", "paused", "unscheduled"].includes(
      (prev as { status: string }).status,
    )
  ) {
    throw new Error("La instalación ya no se puede reprogramar");
  }
  await admin
    .from("installations")
    .update({
      scheduled_at: new Date(newStartsAtIso).toISOString(),
      status: "scheduled",
    })
    .eq("id", installationId);
  revalidatePath("/agenda");
  revalidatePath("/instalaciones");
  revalidatePath(`/instalaciones/${installationId}`);
}

async function rescheduleMaintenanceFromAgenda(
  maintenanceId: string,
  newStartsAtIso: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prev } = await admin
    .from("maintenance_jobs")
    .select("status, company_id")
    .eq("id", maintenanceId)
    .maybeSingle();
  if (!prev) throw new Error("Mantenimiento no encontrado");
  if ((prev as { company_id: string }).company_id !== session.company_id) {
    throw new Error("Mantenimiento de otra empresa");
  }
  if (!["scheduled", "in_progress"].includes((prev as { status: string }).status)) {
    throw new Error("El mantenimiento ya no se puede reprogramar");
  }
  await admin
    .from("maintenance_jobs")
    .update({
      scheduled_at: new Date(newStartsAtIso).toISOString(),
      status: "scheduled",
    })
    .eq("id", maintenanceId);
  revalidatePath("/agenda");
  revalidatePath("/mantenimientos");
  revalidatePath(`/mantenimientos/${maintenanceId}`);
}

// ============================================================================
// Safe wrappers (result pattern) — 2026-05-20
// Devuelven { ok, error } para no perder mensaje real en producción.
// ============================================================================

export async function createAgendaEventSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await createAgendaEventAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function reassignAgendaEventSafeAction(
  eventId: string,
  newAssignedUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await reassignAgendaEventAction(eventId, newAssignedUserId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function updateAgendaStatusSafeAction(
  id: string,
  status:
    | "scheduled"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_show"
    | "rescheduled",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateAgendaStatus(id, status);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Borra (deja fuera de la agenda) una tarea creada por error, sea real o
 * virtual. Reutiliza el patrón de prefijos de reagendar:
 *   · agenda_events   → soft-delete (deleted_at).
 *   · virtual-inst-   → instalación real: soft-delete (deleted_at + cancelled)
 *                       si NO está completada/cancelada. Si ya está instalada,
 *                       remite a la desinstalación (no se borra a lo loco).
 *   · virtual-maint-  → mantenimiento real: status='cancelled' (no tiene
 *                       deleted_at) si NO está completado/cancelado.
 * Admin client salta RLS → SIEMPRE se filtra por company_id (anti cross-tenant).
 */
export async function deleteAgendaTaskSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) throw new Error("Sin empresa");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const nowIso = new Date().toISOString();

    // --- Instalación real ---
    if (id.startsWith("virtual-inst-")) {
      const realId = id.slice("virtual-inst-".length);
      const { data: inst } = await admin
        .from("installations")
        .select("status, company_id")
        .eq("id", realId)
        .maybeSingle();
      if (!inst) throw new Error("Instalación no encontrada");
      if ((inst as { company_id: string }).company_id !== session.company_id) {
        throw new Error("Esa instalación no pertenece a tu empresa");
      }
      if (["completed", "cancelled"].includes((inst as { status: string }).status)) {
        throw new Error(
          "Esa instalación ya está completada o cancelada. Si está instalada, usa la desinstalación.",
        );
      }
      const { error } = await admin
        .from("installations")
        .update({ deleted_at: nowIso, status: "cancelled" })
        .eq("id", realId)
        .eq("company_id", session.company_id);
      if (error) throw new Error(error.message);
      revalidatePath("/agenda");
      revalidatePath("/instalaciones");
      return { ok: true };
    }

    // --- Mantenimiento real ---
    if (id.startsWith("virtual-maint-")) {
      const realId = id.slice("virtual-maint-".length);
      const { data: mj } = await admin
        .from("maintenance_jobs")
        .select("status, company_id")
        .eq("id", realId)
        .maybeSingle();
      if (!mj) throw new Error("Mantenimiento no encontrado");
      if ((mj as { company_id: string }).company_id !== session.company_id) {
        throw new Error("Ese mantenimiento no pertenece a tu empresa");
      }
      if (["completed", "cancelled"].includes((mj as { status: string }).status)) {
        throw new Error("Ese mantenimiento ya está completado o cancelado.");
      }
      const { error } = await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled" })
        .eq("id", realId)
        .eq("company_id", session.company_id);
      if (error) throw new Error(error.message);
      revalidatePath("/agenda");
      revalidatePath("/mantenimientos");
      return { ok: true };
    }

    // --- Tarea normal de agenda ---
    const { data, error } = await admin
      .from("agenda_events")
      .update({ deleted_at: nowIso, status: "cancelled" })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) {
      throw new Error("Tarea no encontrada o no pertenece a tu empresa");
    }
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Cambia el TIPO (kind) de una tarea NORMAL de agenda (corrige "lo agendé como
 * instalación y era una visita/llamada"). NO aplica a instalaciones ni
 * mantenimientos reales (virtuales): esos son fichas de trabajo con técnico,
 * furgoneta y stock; para cambiarlos, se borra y se crea el correcto. Filtra
 * por company_id (admin client salta RLS).
 */
export async function changeAgendaEventKindSafeAction(
  id: string,
  newKind: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (id.startsWith("virtual-")) {
      return {
        ok: false,
        error:
          "Esta tarea es una instalación o un mantenimiento real. Para cambiarlo, bórralo y crea el correcto.",
      };
    }
    if (!(AGENDA_KIND as readonly string[]).includes(newKind)) {
      return { ok: false, error: "Tipo de tarea no válido" };
    }
    const session = await requireSession();
    if (!session.company_id) throw new Error("Sin empresa");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("agenda_events")
      .update({ kind: newKind })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) {
      throw new Error("Tarea no encontrada o no pertenece a tu empresa");
    }
    revalidatePath("/agenda");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
