"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { getPointsSettings } from "./award";

export interface MilestoneStatus {
  threshold: number;
  bonus_points: number;
  label: string;
  reached: boolean;
  reached_at: string | null;
}

export interface MyMilestones {
  current_month_points: number;
  euros_per_point: number;
  estimated_euros_month: number;
  milestones: MilestoneStatus[];
}

/**
 * Devuelve hitos del mes actual del usuario logueado: cuáles ya alcanzó
 * (con fecha) y cuáles le quedan, junto con sus puntos totales del mes
 * y la conversión a € si está configurada.
 */
export async function getMyMilestones(): Promise<MyMilestones> {
  const session = await requireSession();
  if (!session.company_id) {
    return {
      current_month_points: 0,
      euros_per_point: 0,
      estimated_euros_month: 0,
      milestones: [],
    };
  }
  const cfg = await getPointsSettings(session.company_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: ledger } = await admin
    .from("points_ledger")
    .select("points, reason, metadata, awarded_at")
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .eq("period_year", year)
    .eq("period_month", month);
  type LR = {
    points: number;
    reason: string;
    metadata: { milestone_key?: string; threshold?: number } | null;
    awarded_at: string;
  };
  const rows = (ledger ?? []) as LR[];
  const totalNet = rows
    .filter((r) => r.reason !== "milestone_reached")
    .reduce((s, r) => s + r.points, 0);

  // Mapa de hitos otorgados este mes. La clave/threshold vive en metadata
  // (points_ledger no tiene subject_id).
  const reachedMap = new Map<number, string>();
  for (const r of rows.filter((r) => r.reason === "milestone_reached")) {
    const threshold =
      r.metadata?.threshold ??
      (r.metadata?.milestone_key
        ? parseInt(r.metadata.milestone_key.match(/-(\d+)$/)?.[1] ?? "", 10)
        : NaN);
    if (Number.isFinite(threshold)) reachedMap.set(threshold as number, r.awarded_at);
  }

  const sorted = [...(cfg.monthly_milestones ?? [])].sort(
    (a, b) => a.threshold - b.threshold,
  );
  const milestones: MilestoneStatus[] = sorted.map((m) => ({
    threshold: m.threshold,
    bonus_points: m.bonus_points,
    label: m.label,
    reached: reachedMap.has(m.threshold) || totalNet >= m.threshold,
    reached_at: reachedMap.get(m.threshold) ?? null,
  }));

  // Total con bonuses incluidos para mostrar
  const totalWithBonus = rows.reduce((s, r) => s + r.points, 0);
  const eurosPerPoint = cfg.euros_per_point ?? 0;
  const estimatedEuros = totalWithBonus * eurosPerPoint;

  return {
    current_month_points: totalNet,
    euros_per_point: eurosPerPoint,
    estimated_euros_month: estimatedEuros,
    milestones,
  };
}

export interface MonthlyHistoryPoint {
  year: number;
  month: number;
  total_points: number;
}

export async function getMyPointsHistory(months = 12): Promise<MonthlyHistoryPoint[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const { data } = await admin
    .from("points_ledger")
    .select("points, period_year, period_month")
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .gte("awarded_at", since.toISOString());
  type R = { points: number; period_year: number; period_month: number };
  const rows = (data ?? []) as R[];
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.period_year}-${String(r.period_month).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + r.points);
  }
  // Construir array desde el mes más antiguo al más reciente
  const result: MonthlyHistoryPoint[] = [];
  const cursor = new Date(since);
  cursor.setDate(1);
  for (let i = 0; i < months; i++) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    result.push({ year: y, month: m, total_points: map.get(key) ?? 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}
