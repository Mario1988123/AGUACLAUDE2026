"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface AuditLogRow {
  id: string;
  actor_name: string | null;
  action: string;
  affected_company_name: string | null;
  subject_type: string | null;
  subject_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Helper que cualquier action de superadmin puede llamar para registrar
 * lo que hizo. Idempotente, fail-soft si la tabla no está migrada.
 */
export async function logSuperadminAction(input: {
  action: string;
  affected_company_id?: string | null;
  subject_type?: string | null;
  subject_id?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const session = await requireSession();
    if (!session.is_superadmin) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.from("superadmin_audit_log").insert({
      actor_user_id: session.user_id,
      action: input.action,
      affected_company_id: input.affected_company_id ?? null,
      subject_type: input.subject_type ?? null,
      subject_id: input.subject_id ?? null,
      payload: input.payload ?? {},
    });
  } catch {
    /* fail-soft */
  }
}

export async function listSuperadminAudit(filters?: {
  action?: string;
  company_id?: string;
  days?: number;
}): Promise<AuditLogRow[]> {
  const session = await requireSession();
  if (!session.is_superadmin) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    let q = admin
      .from("superadmin_audit_log")
      .select(
        "id, actor_user_id, action, affected_company_id, subject_type, subject_id, payload, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (filters?.action) q = q.eq("action", filters.action);
    if (filters?.company_id) q = q.eq("affected_company_id", filters.company_id);
    if (filters?.days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.days);
      q = q.gte("created_at", cutoff.toISOString());
    }
    const { data } = await q;
    type Row = Omit<AuditLogRow, "actor_name" | "affected_company_name"> & {
      actor_user_id: string;
      affected_company_id: string | null;
    };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];
    const userIds = Array.from(new Set(rows.map((r) => r.actor_user_id)));
    const companyIds = Array.from(
      new Set(rows.map((r) => r.affected_company_id).filter((v): v is string => !!v)),
    );
    const [profsRes, compsRes] = await Promise.all([
      admin.from("user_profiles").select("user_id, full_name").in("user_id", userIds),
      companyIds.length > 0
        ? admin.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [] }),
    ]);
    const profMap = new Map(
      ((profsRes.data ?? []) as Array<{ user_id: string; full_name: string }>).map(
        (p) => [p.user_id, p.full_name],
      ),
    );
    const compMap = new Map(
      ((compsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [
        c.id,
        c.name,
      ]),
    );
    return rows.map((r) => ({
      id: r.id,
      actor_name: profMap.get(r.actor_user_id) ?? null,
      action: r.action,
      affected_company_name: r.affected_company_id
        ? compMap.get(r.affected_company_id) ?? null
        : null,
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      payload: r.payload,
      created_at: r.created_at,
    }));
  } catch {
    return [];
  }
}
