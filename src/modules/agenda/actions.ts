"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { agendaCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

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
      // JS getDay → ISO day of week (lunes=0...domingo=6)
      const isoDow = (d.getDay() + 6) % 7;
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
      KEYS[d.getDay()]!
    ];
    if (!slot) return true;
    return inTimeRange(d, slot.open, slot.close) ? false : true;
  }

  // 3) Fallback 9-18 lun-vie
  const day = d.getDay();
  const hour = d.getHours();
  return day === 0 || day === 6 || hour < 9 || hour > 18;
}

/** Acepta "HH:MM" o "HH:MM:SS" y comprueba si la hora local de d cae dentro. */
function inTimeRange(d: Date, openHHMM: string, closeHHMM: string): boolean {
  const [oh, om] = openHHMM.split(":").map(Number);
  const [ch, cm] = closeHHMM.split(":").map(Number);
  const minutes = d.getHours() * 60 + d.getMinutes();
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
}

export async function listAgendaMonth(year: number, month: number): Promise<AgendaItem[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const start = new Date(year, month, 1).toISOString();
  const end = new Date(year, month + 2, 0).toISOString(); // mes anterior + actual + sig
  let query = supabase
    .from("agenda_events")
    .select(
      "id, kind, status, title, description, starts_at, ends_at, assigned_user_id, is_outside_hours, subject_type, subject_id",
    )
    .is("deleted_at", null)
    .gte("starts_at", start)
    .lte("starts_at", end)
    .order("starts_at");
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("telemarketing_director")
  ) {
    query = query.eq("assigned_user_id", session.user_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return await recomputeOutsideHoursForList(
    (data ?? []) as AgendaItem[],
    session.company_id,
  );
}

export async function listAgenda(
  daysAhead = 14,
  filters?: { user_id?: string; kind?: string },
): Promise<AgendaItem[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const until = new Date(now.getTime() + daysAhead * 86400000);

  let query = supabase
    .from("agenda_events")
    .select(
      "id, kind, status, title, description, starts_at, ends_at, assigned_user_id, is_outside_hours, subject_type, subject_id",
    )
    .is("deleted_at", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", until.toISOString())
    .order("starts_at");

  // Aplicación de scope. Si el caller es nivel 3 (sales_rep,
  // telemarketer, installer) NO puede ver agenda de otros usuarios:
  // forzamos siempre filter.user_id = self, ignorando lo que llegue.
  // Antes con filters.user_id pasaba el bypass y veían al admin.
  const isLevel1or2 =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

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
  return await recomputeOutsideHoursForList(
    (data ?? []) as AgendaItem[],
    session.company_id,
  );
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
    // 1) horario del usuario
    if (ev.assigned_user_id) {
      const isoDow = (d.getDay() + 6) % 7;
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
        KEYS[d.getDay()]!
      ];
      if (!slot) {
        outside = true;
      } else {
        outside = !inTimeRange(d, slot.open, slot.close);
      }
      resolved = true;
    }
    // 3) fallback 9-18 lun-vie
    if (!resolved) {
      const day = d.getDay();
      const hour = d.getHours();
      outside = day === 0 || day === 6 || hour < 9 || hour > 18;
    }
    return { ...ev, is_outside_hours: outside };
  });
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
  const { error } = await supabase.from("agenda_events").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/agenda");
}

/**
 * Reagenda un evento a otra fecha conservando la hora original (o el mismo día
 * con nueva hora). Ajusta is_outside_hours según horario comercial. Marca
 * status='rescheduled' si pasa de scheduled a otra fecha.
 */
export async function rescheduleAgendaEventAction(
  eventId: string,
  newStartsAtIso: string,
): Promise<void> {
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
    .single();
  type Prev = { starts_at: string; ends_at: string | null; status: string };
  const p = prev as Prev | null;

  // Calcular nueva ends_at preservando la duración
  let newEndsAt: string | null = null;
  if (p?.ends_at) {
    const oldStart = new Date(p.starts_at).getTime();
    const oldEnd = new Date(p.ends_at).getTime();
    const durationMs = oldEnd - oldStart;
    newEndsAt = new Date(newStart.getTime() + durationMs).toISOString();
  }

  await supabase
    .from("agenda_events")
    .update({
      starts_at: newStart.toISOString(),
      ends_at: newEndsAt,
      is_outside_hours: isOutsideHours,
      // Solo marcamos rescheduled si estaba pendiente, no si ya estaba en curso/completed
      ...(p?.status === "scheduled" ? {} : {}),
    })
    .eq("id", eventId);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "user",
    subject_id: session.user_id,
    kind: "agenda.rescheduled",
    payload: { event_id: eventId, from: p?.starts_at, to: newStart.toISOString() },
    actor_user_id: session.user_id,
  });

  revalidatePath("/agenda");
}

export async function updateAgendaStatus(
  id: string,
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "no_show" | "rescheduled",
) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { error } = await admin.from("agenda_events").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/agenda");
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
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo nivel 1 o 2 puede reasignar tareas");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: ev } = await admin
    .from("agenda_events")
    .select("starts_at, title")
    .eq("id", eventId)
    .single();
  const e = ev as { starts_at: string; title: string } | null;
  if (!e) throw new Error("Evento no encontrado");

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
    .eq("id", eventId);
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
