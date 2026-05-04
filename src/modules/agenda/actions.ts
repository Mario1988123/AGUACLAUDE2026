"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { agendaCreateSchema } from "./schemas";

/**
 * Devuelve true si la fecha cae fuera del horario comercial configurado
 * en company_settings.business_hours. Si no hay setting, fallback al
 * antiguo 9-18 lun-vie.
 *
 * business_hours es un objeto { mon: { open: "09:00", close: "18:00" }, ... }
 * con keys mon/tue/wed/thu/fri/sat/sun. Un null en una key = cerrado.
 */
function isOutsideBusinessHours(
  d: Date,
  bh: Record<string, { open: string; close: string } | null> | null,
): boolean {
  if (!bh) {
    const day = d.getDay();
    const hour = d.getHours();
    return day === 0 || day === 6 || hour < 9 || hour > 18;
  }
  const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const slot = bh[KEYS[d.getDay()]!];
  if (!slot) return true;
  const [oh, om] = slot.open.split(":").map(Number);
  const [ch, cm] = slot.close.split(":").map(Number);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes < (oh ?? 0) * 60 + (om ?? 0) || minutes > (ch ?? 0) * 60 + (cm ?? 0);
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
  return (data ?? []) as AgendaItem[];
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

  if (filters?.user_id) {
    query = query.eq("assigned_user_id", filters.user_id);
  } else if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("telemarketing_director")
  ) {
    query = query.eq("assigned_user_id", session.user_id);
  }

  if (filters?.kind) {
    query = query.eq("kind", filters.kind);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AgendaItem[];
}

export async function listTeamMembers(): Promise<{ user_id: string; full_name: string }[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("user_profiles")
    .select("user_id, full_name")
    .eq("company_id", session.company_id)
    .order("full_name");
  return (data ?? []) as { user_id: string; full_name: string }[];
}

export async function createAgendaEventAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = agendaCreateSchema.parse(input);

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

  // Cargar business_hours configurado para calcular is_outside_hours
  // (antes era hardcoded 9-18). Si no hay setting, fallback al 9-18.
  let businessHours: Record<string, { open: string; close: string } | null> | null = null;
  try {
    const { data: cs } = await supabase
      .from("company_settings")
      .select("business_hours")
      .eq("company_id", session.company_id)
      .maybeSingle();
    businessHours = (cs as { business_hours: typeof businessHours } | null)?.business_hours ?? null;
  } catch {
    /* no-op */
  }

  const rows = [];
  for (let i = 0; i < occurrences; i++) {
    const s = bumpDate(baseStart, i);
    const e = baseEnd ? new Date(s.getTime() + durationMs) : null;
    const isOutsideHours = isOutsideBusinessHours(s, businessHours);
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
  let businessHours: Record<string, { open: string; close: string } | null> | null = null;
  try {
    const { data: cs } = await supabase
      .from("company_settings")
      .select("business_hours")
      .eq("company_id", session.company_id)
      .maybeSingle();
    businessHours = (cs as { business_hours: typeof businessHours } | null)?.business_hours ?? null;
  } catch {
    /* no-op */
  }
  const isOutsideHours = isOutsideBusinessHours(newStart, businessHours);

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
  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("agenda_events").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/agenda");
}
