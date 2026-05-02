"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { agendaCreateSchema } from "./schemas";

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

export async function listAgenda(daysAhead = 14): Promise<AgendaItem[]> {
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

  // Comprobación horario comercial (si fuera de 9-18 lun-vie marca flag)
  const start = new Date(parsed.starts_at);
  const day = start.getDay();
  const hour = start.getHours();
  const isOutsideHours = day === 0 || day === 6 || hour < 9 || hour > 18;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("agenda_events").insert({
    company_id: session.company_id,
    kind: parsed.kind,
    title: parsed.title,
    description: parsed.description || null,
    starts_at: parsed.starts_at,
    ends_at: parsed.ends_at || null,
    all_day: parsed.all_day,
    assigned_user_id: parsed.assigned_user_id || session.user_id,
    subject_type: parsed.subject_type || null,
    subject_id: parsed.subject_id || null,
    is_outside_hours: isOutsideHours,
    reminders_min_before: parsed.reminders_min_before,
    created_by: session.user_id,
  });
  if (error) throw new Error(error.message);
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
