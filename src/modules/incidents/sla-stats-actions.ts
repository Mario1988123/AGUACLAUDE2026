"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface SlaStats {
  period_label: string;
  total: number;
  on_time: number;
  late: number;
  pending: number;
  compliance_pct: number;
  by_priority: Record<
    string,
    { total: number; on_time: number; late: number; pending: number }
  >;
  by_technician: Array<{
    user_id: string;
    user_name: string;
    total: number;
    on_time: number;
    late: number;
    compliance_pct: number;
  }>;
}

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Estadísticas de cumplimiento SLA del mes indicado.
 * Solo accesible para nivel 1 (admin) y nivel 2 (directores).
 */
export async function getSlaStats(year: number, month: number): Promise<SlaStats | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  const allowed =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!allowed) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0);

  const { data: rows } = await admin
    .from("incidents")
    .select(
      "id, priority, status, created_at, deadline_at, resolved_at, assigned_user_id",
    )
    .eq("company_id", session.company_id)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .limit(2000);

  type Row = {
    id: string;
    priority: string;
    status: string;
    created_at: string;
    deadline_at: string | null;
    resolved_at: string | null;
    assigned_user_id: string | null;
  };
  const incidents = (rows ?? []) as Row[];
  const now = Date.now();

  const stats: SlaStats = {
    period_label: `${String(month).padStart(2, "0")}/${year}`,
    total: incidents.length,
    on_time: 0,
    late: 0,
    pending: 0,
    compliance_pct: 0,
    by_priority: {},
    by_technician: [],
  };
  for (const p of PRIORITIES) {
    stats.by_priority[p] = { total: 0, on_time: 0, late: 0, pending: 0 };
  }

  type Acc = {
    user_id: string;
    total: number;
    on_time: number;
    late: number;
  };
  const techMap = new Map<string, Acc>();

  for (const inc of incidents) {
    const pBucket = stats.by_priority[inc.priority] ?? null;
    if (pBucket) pBucket.total += 1;

    const techId = inc.assigned_user_id;
    if (techId) {
      let acc = techMap.get(techId);
      if (!acc) {
        acc = { user_id: techId, total: 0, on_time: 0, late: 0 };
        techMap.set(techId, acc);
      }
      acc.total += 1;
    }

    if (inc.status === "resolved" || inc.status === "closed") {
      if (inc.deadline_at && inc.resolved_at) {
        const onTime =
          new Date(inc.resolved_at).getTime() <=
          new Date(inc.deadline_at).getTime();
        if (onTime) {
          stats.on_time += 1;
          if (pBucket) pBucket.on_time += 1;
          if (techId) {
            const acc = techMap.get(techId)!;
            acc.on_time += 1;
          }
        } else {
          stats.late += 1;
          if (pBucket) pBucket.late += 1;
          if (techId) {
            const acc = techMap.get(techId)!;
            acc.late += 1;
          }
        }
      }
    } else {
      // Pendiente: si ya pasó deadline, cuenta como late predictivo
      if (inc.deadline_at && new Date(inc.deadline_at).getTime() < now) {
        stats.late += 1;
        if (pBucket) pBucket.late += 1;
        if (techId) {
          const acc = techMap.get(techId)!;
          acc.late += 1;
        }
      } else {
        stats.pending += 1;
        if (pBucket) pBucket.pending += 1;
      }
    }
  }
  const closed = stats.on_time + stats.late;
  stats.compliance_pct = closed > 0 ? Math.round((stats.on_time / closed) * 100) : 100;

  // Resolver nombres
  const techIds = Array.from(techMap.keys());
  const nameMap = new Map<string, string>();
  if (techIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", techIds);
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      full_name: string | null;
    }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  stats.by_technician = Array.from(techMap.values())
    .map((a) => {
      const closed = a.on_time + a.late;
      return {
        user_id: a.user_id,
        user_name: nameMap.get(a.user_id) ?? a.user_id.slice(0, 8),
        total: a.total,
        on_time: a.on_time,
        late: a.late,
        compliance_pct: closed > 0 ? Math.round((a.on_time / closed) * 100) : 100,
      };
    })
    .sort((a, b) => b.compliance_pct - a.compliance_pct);

  return stats;
}
