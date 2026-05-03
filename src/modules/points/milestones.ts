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

  // Suma del mes (excluyendo bonuses de hitos para no contar el bonus dentro del threshold)
  const { data: rows } = await admin
    .from("points_ledger")
    .select("points, reason")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("period_year", year)
    .eq("period_month", month);
  type R = { points: number; reason: string };
  const totalNet = ((rows ?? []) as R[])
    .filter((r) => r.reason !== "milestone_reached")
    .reduce((s, r) => s + r.points, 0);

  // Hitos ya otorgados este mes
  const grantedKeys = new Set(
    ((rows ?? []) as Array<R & { subject_id?: string }>)
      .filter((r) => r.reason === "milestone_reached")
      .map((r) => (r as unknown as { subject_id?: string }).subject_id ?? ""),
  );
  // ⚠ los rows no traen subject_id; consultamos aparte para precisión
  const { data: milestoneRows } = await admin
    .from("points_ledger")
    .select("subject_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("period_year", year)
    .eq("period_month", month)
    .eq("reason", "milestone_reached");
  for (const r of (milestoneRows ?? []) as Array<{ subject_id: string }>) {
    if (r.subject_id) grantedKeys.add(r.subject_id);
  }

  const awarded: number[] = [];
  const sorted = [...cfg.monthly_milestones].sort((a, b) => a.threshold - b.threshold);
  for (const m of sorted) {
    if (totalNet < m.threshold) break;
    const key = `${year}-${month}-${m.threshold}`;
    if (grantedKeys.has(key)) continue;
    await admin.from("points_ledger").insert({
      company_id: companyId,
      user_id: userId,
      points: m.bonus_points,
      reason: "milestone_reached",
      subject_type: "milestone",
      subject_id: key,
      metadata: { threshold: m.threshold, label: m.label },
      period_year: year,
      period_month: month,
      awarded_at: new Date().toISOString(),
    });
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
