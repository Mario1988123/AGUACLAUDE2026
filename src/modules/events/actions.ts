"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface TimelineEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
}

export async function listSubjectEvents(
  subjectType: string,
  subjectId: string,
  limit = 30,
): Promise<TimelineEvent[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("events")
    .select("id, kind, payload, occurred_at, actor_user_id")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  type R = {
    id: string;
    kind: string;
    payload: Record<string, unknown> | null;
    occurred_at: string;
    actor_user_id: string | null;
  };
  const rows = (data ?? []) as R[];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.actor_user_id).filter(Boolean) as string[]));
  let nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", ids);
    nameMap = new Map(
      ((profiles ?? []) as { user_id: string; full_name: string }[]).map((p) => [
        p.user_id,
        p.full_name,
      ]),
    );
  }
  return rows.map((r) => ({
    ...r,
    actor_name: r.actor_user_id ? nameMap.get(r.actor_user_id) ?? null : null,
  }));
}
