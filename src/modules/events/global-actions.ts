"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface GlobalEventRow {
  id: string;
  subject_type: string;
  subject_id: string;
  kind: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
}

export async function listGlobalEvents(filters?: {
  kind?: string;
  subject_type?: string;
  actor_user_id?: string;
  limit?: number;
}): Promise<GlobalEventRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  let query = supabase
    .from("events")
    .select("id, subject_type, subject_id, kind, payload, occurred_at, actor_user_id")
    .eq("company_id", session.company_id)
    .order("occurred_at", { ascending: false })
    .limit(filters?.limit ?? 200);

  if (filters?.kind) query = query.eq("kind", filters.kind);
  if (filters?.subject_type) query = query.eq("subject_type", filters.subject_type);
  if (filters?.actor_user_id) query = query.eq("actor_user_id", filters.actor_user_id);

  const { data } = await query;
  const rows = (data ?? []) as Array<Omit<GlobalEventRow, "actor_name">>;

  const actorIds = Array.from(
    new Set(rows.map((r) => r.actor_user_id).filter((v): v is string => !!v)),
  );
  const nameMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", actorIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }

  return rows.map((r) => ({
    ...r,
    actor_name: r.actor_user_id ? nameMap.get(r.actor_user_id) ?? null : null,
  }));
}
