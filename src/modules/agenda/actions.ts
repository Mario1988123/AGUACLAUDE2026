"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface AgendaItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  assigned_user_id: string | null;
  is_outside_hours: boolean;
}

export async function listAgenda(daysAhead = 14): Promise<AgendaItem[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const now = new Date();
  const until = new Date(now.getTime() + daysAhead * 86400000);

  let query = supabase
    .from("agenda_events")
    .select("id, kind, status, title, starts_at, ends_at, assigned_user_id, is_outside_hours")
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
