"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Calcula el churn score (0-100) para un cliente y lo guarda en
 * customers.churn_score / churn_score_at. Mayor = más riesgo de abandono.
 *
 * Componentes (cada uno suma puntos hasta 100):
 *  - Inactividad >180d: +30
 *  - Sin contrato activo con equipo instalado: +20
 *  - Pago fallado / devolución último 90d: +25
 *  - Mantenimiento vencido sin completar >30d: +15
 *  - NPS bajo (≤2) último mantenimiento: +10
 *
 * Fail-soft: si una query falla, ese componente suma 0.
 */
export async function recomputeChurnScoreAction(
  customerId: string,
): Promise<{ ok: true; score: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    let score = 0;
    const now = Date.now();

    // 1) Inactividad >180d
    try {
      const past180 = new Date(now - 180 * 86400000).toISOString();
      const { count: recent } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("subject_type", "customer")
        .eq("subject_id", customerId)
        .gt("created_at", past180);
      // Mira también si tiene equipo activo
      const { count: hasEq } = await admin
        .from("customer_equipment")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("status", "active");
      if ((recent ?? 0) === 0 && (hasEq ?? 0) > 0) score += 30;
    } catch {
      /* */
    }

    // 2) Con equipo pero sin contrato activo
    try {
      const { count: eq } = await admin
        .from("customer_equipment")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("status", "active");
      const { count: contracts } = await admin
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .in("status", ["active", "signed"])
        .is("deleted_at", null);
      if ((eq ?? 0) > 0 && (contracts ?? 0) === 0) score += 20;
    } catch {
      /* */
    }

    // 3) Pago fallado último 90d
    try {
      const past90 = new Date(now - 90 * 86400000).toISOString();
      const { count } = await admin
        .from("wallet_entries")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .in("status", ["rejected", "cancelled"])
        .gt("created_at", past90);
      if ((count ?? 0) > 0) score += 25;
    } catch {
      /* */
    }

    // 4) Mantenimiento vencido sin completar >30d
    try {
      const past30 = new Date(now - 30 * 86400000).toISOString();
      const { count } = await admin
        .from("maintenance_jobs")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .eq("status", "scheduled")
        .lt("scheduled_at", past30);
      if ((count ?? 0) > 0) score += 15;
    } catch {
      /* */
    }

    // 5) NPS bajo último mantenimiento
    try {
      const { data: last } = await admin
        .from("maintenance_jobs")
        .select("nps_score")
        .eq("customer_id", customerId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nps = (last as { nps_score: number | null } | null)?.nps_score;
      if (nps != null && nps <= 2) score += 10;
    } catch {
      /* */
    }

    score = Math.min(100, score);

    try {
      await admin
        .from("customers")
        .update({ churn_score: score, churn_score_at: new Date().toISOString() })
        .eq("id", customerId);
    } catch {
      /* tabla puede no estar migrada */
    }
    return { ok: true, score };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
