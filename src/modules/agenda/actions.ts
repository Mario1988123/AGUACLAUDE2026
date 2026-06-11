"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { agendaCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import {
  madridHour,
  madridMinutesOfDay,
  madridIsoDow,
  madridJsDay,
  madridDayRangeUtc,
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
}

export async function listAgendaMonth(year: number, month: number): Promise<AgendaItem[]> {
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
  if (!isLevel1or2) {
    query = query.eq("assigned_user_id", session.user_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  const events = (data ?? []) as AgendaItem[];

  // Añadir instalaciones y mantenimientos programados (bug 2026-05-11:
  // si markContractSigned NO consigue crear el row de agenda_events por
  // fail-soft, la instalación tenía scheduled_at pero NO aparecía en
  // agenda. Ahora las leemos directas de installations + maintenance_jobs).
  const virtuals = await loadVirtualAgendaItems({
    from: start,
    to: end,
    restrictToUserId: isLevel1or2 ? null : session.user_id,
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
  const merged = [
    ...events,
    ...virtuals.filter((v) => {
      if (existingKey.has(`${v.subject_type}:${v.subject_id}`)) return false;
      const m = refRegex.exec(v.title);
      if (m && existingRefAt.has(`${m[1]}@${v.starts_at}`)) return false;
      return true;
    }),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  await enrichTitlesFromSubjects(merged);
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

  await enrichTitlesFromSubjects(merged);
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
async function enrichTitlesFromSubjects(events: AgendaItem[]): Promise<void> {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  type InstRow = { id: string; reference_code: string | null; customer_id: string | null };
  type MaintRow = { id: string; customer_id: string | null };

  const [instRes, maintRes] = await Promise.all([
    installationIds.size > 0
      ? supabase
          .from("installations")
          .select("id, reference_code, customer_id")
          .in("id", Array.from(installationIds))
      : Promise.resolve({ data: [] as InstRow[] }),
    maintenanceIds.size > 0
      ? supabase
          .from("maintenance_jobs")
          .select("id, customer_id")
          .in("id", Array.from(maintenanceIds))
      : Promise.resolve({ data: [] as MaintRow[] }),
  ]);
  const insts = (instRes.data ?? []) as InstRow[];
  const maints = (maintRes.data ?? []) as MaintRow[];

  const custIds = new Set<string>();
  for (const i of insts) if (i.customer_id) custIds.add(i.customer_id);
  for (const m of maints) if (m.customer_id) custIds.add(m.customer_id);
  for (const id of directCustomerIds) custIds.add(id);

  const nameMap = new Map<string, string>();
  if (custIds.size > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", Array.from(custIds));
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

  // Nombres de leads vinculados directamente a una tarea.
  const leadNameMap = new Map<string, string>();
  if (leadIds.size > 0) {
    const { data: ls } = await supabase
      .from("leads")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", Array.from(leadIds));
    for (const l of (ls ?? []) as Array<{
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>) {
      leadNameMap.set(
        l.id,
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Lead"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Lead",
      );
    }
  }

  const instById = new Map(insts.map((i) => [i.id, i]));
  const maintById = new Map(maints.map((m) => [m.id, m]));

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
    } else if (e.subject_type === "maintenance") {
      const m = maintById.get(e.subject_id);
      if (!m) continue;
      const cust = m.customer_id ? nameMap.get(m.customer_id) : null;
      if (cust) {
        e.title = `Mantenimiento · ${cust}`;
        e.subject_label = cust;
      }
    } else if (e.subject_type === "customer") {
      // Tarea manual vinculada a un cliente: conservamos el título que
      // escribió el usuario y añadimos el nombre del cliente.
      const cust = nameMap.get(e.subject_id);
      if (cust) {
        e.subject_label = cust;
        if (!e.title.includes(cust)) e.title = `${e.title} · ${cust}`;
      }
    } else if (e.subject_type === "lead") {
      const lead = leadNameMap.get(e.subject_id);
      if (lead) {
        e.subject_label = lead;
        if (!e.title.includes(lead)) e.title = `${e.title} · ${lead}`;
      }
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

  // Calcular fechas de la serie según recurrencia
  const baseStart = new Date(parsed.starts_at);
  const baseEnd = parsed.ends_at ? new Date(parsed.ends_at) : null;
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
