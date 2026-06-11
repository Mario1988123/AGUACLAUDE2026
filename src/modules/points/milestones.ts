"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { getPointsSettings } from "./award";

/**
 * Comprueba si el usuario ha alcanzado algún hito mensual nuevo y, si es así,
 * otorga el bonus correspondiente como entrada extra en points_ledger con
 * reason 'milestone_reached'. Idempotente: usa subject_type='milestone' +
 * subject_id={year-month-threshold} para evitar duplicados.
 */
export async function checkAndAwardMilestones(
  companyId: string,
  userId: string,
): Promise<number[]> {
  const cfg = await getPointsSettings(companyId);
  if (!cfg.monthly_milestones || cfg.monthly_milestones.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // points_ledger NO tiene subject_id/subject_type; la clave del hito vive en
  // metadata->>'milestone_key'. Leemos points/reason/metadata del mes.
  const { data: rows } = await admin
    .from("points_ledger")
    .select("points, reason, metadata")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("period_year", year)
    .eq("period_month", month);
  type R = { points: number; reason: string; metadata: { milestone_key?: string } | null };
  const allRows = (rows ?? []) as R[];
  // Suma del mes EXCLUYENDO los bonus de hito (para no inflar el threshold).
  const totalNet = allRows
    .filter((r) => r.reason !== "milestone_reached")
    .reduce((s, r) => s + r.points, 0);

  // Hitos ya otorgados este mes (clave en metadata).
  const grantedKeys = new Set(
    allRows
      .filter((r) => r.reason === "milestone_reached")
      .map((r) => r.metadata?.milestone_key ?? "")
      .filter(Boolean),
  );

  const awarded: number[] = [];
  const sorted = [...cfg.monthly_milestones].sort((a, b) => a.threshold - b.threshold);
  for (const m of sorted) {
    if (totalNet < m.threshold) break;
    const key = `${year}-${month}-${m.threshold}`;
    if (grantedKeys.has(key)) continue;
    const { error: insErr } = await admin.from("points_ledger").insert({
      company_id: companyId,
      user_id: userId,
      points: m.bonus_points,
      reason: "milestone_reached",
      metadata: { milestone_key: key, threshold: m.threshold, label: m.label },
      period_year: year,
      period_month: month,
      awarded_at: new Date().toISOString(),
    });
    if (insErr) {
      // p.ej. migración metadata aún no aplicada → no otorgar (ni notificar)
      console.error("[milestones] insert bonus falló:", insErr.message);
      continue;
    }
    awarded.push(m.threshold);

    // Notificar al usuario
    try {
      await admin.from("notifications").insert({
        company_id: companyId,
        recipient_user_id: userId,
        kind: "milestone_reached",
        severity: "success",
        title: "🏆 ¡Hito alcanzado!",
        body: `Has llegado a ${m.label} este mes y ganas +${m.bonus_points} puntos extra.`,
      });
    } catch {
      /* fail-soft */
    }
  }
  return awarded;
}
