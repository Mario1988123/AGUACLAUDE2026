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

export interface GlobalEventsFilters {
  kind?: string;
  subject_type?: string;
  actor_user_id?: string;
  /** ISO date desde (incluido) */
  from?: string;
  /** ISO date hasta (incluido) */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface GlobalEventsPage {
  rows: GlobalEventRow[];
  total: number;
}

async function buildQuery(filters: GlobalEventsFilters | undefined, withCount: boolean) {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  let query = supabase
    .from("events")
    .select(
      "id, subject_type, subject_id, kind, payload, occurred_at, actor_user_id",
      withCount ? { count: "exact" } : undefined,
    )
    .eq("company_id", session.company_id)
    .order("occurred_at", { ascending: false });

  if (filters?.kind) query = query.eq("kind", filters.kind);
  if (filters?.subject_type) query = query.eq("subject_type", filters.subject_type);
  if (filters?.actor_user_id) query = query.eq("actor_user_id", filters.actor_user_id);
  if (filters?.from) query = query.gte("occurred_at", filters.from);
  if (filters?.to) query = query.lte("occurred_at", filters.to);
  return { supabase, query };
}

export async function listGlobalEvents(filters?: GlobalEventsFilters): Promise<GlobalEventRow[]> {
  const built = await buildQuery(filters, false);
  if (!built) return [];
  const { query } = built;
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 50;
  const { data } = await query.range(offset, offset + limit - 1);
  const rows = (data ?? []) as Array<Omit<GlobalEventRow, "actor_name">>;
  return await enrichWithActorName(built.supabase, rows);
}

export async function listGlobalEventsPage(
  filters?: GlobalEventsFilters,
): Promise<GlobalEventsPage> {
  const built = await buildQuery(filters, true);
  if (!built) return { rows: [], total: 0 };
  const { query } = built;
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 50;
  const { data, count } = await query.range(offset, offset + limit - 1);
  const raw = (data ?? []) as Array<Omit<GlobalEventRow, "actor_name">>;
  const rows = await enrichWithActorName(built.supabase, raw);
  return { rows, total: count ?? rows.length };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichWithActorName(supabase: any, rows: Array<Omit<GlobalEventRow, "actor_name">>) {
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
