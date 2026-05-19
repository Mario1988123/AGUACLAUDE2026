"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { DEFAULT_POINTS_SETTINGS, type PointsSettings } from "./settings";

/**
 * Lee la configuración de puntos para una empresa. Si no hay valores guardados,
 * devuelve los defaults.
 */
export async function getPointsSettings(companyId: string): Promise<PointsSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("company_settings")
    .select("points_settings")
    .eq("company_id", companyId)
    .maybeSingle();
  const stored = (data?.points_settings ?? {}) as Partial<PointsSettings>;
  return { ...DEFAULT_POINTS_SETTINGS, ...stored };
}

interface AwardArgs {
  company_id: string;
  user_id: string;
  points: number;
  reason: string;
  subject_type?:
    | "lead"
    | "contract"
    | "proposal"
    | "installation"
    | "maintenance"
    | "incident"
    | "sales_record";
  subject_id?: string;
  contract_id?: string | null;
  installation_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Inserta un asiento en points_ledger. Fail-soft: si falla NO tumba el flujo
 * principal (siempre llamarlo dentro de try/catch o ignorando errores).
 *
 * Period_year/month se calculan de la fecha actual.
 */
export async function awardPoints(args: AwardArgs): Promise<void> {
  if (args.points === 0) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();

  // Idempotencia (decisión 2026-05-20): si ya existe una entrada con
  // mismo user_id + reason + subject_type + subject_id, no insertamos
  // otra. Caso típico: webhook que reintenta o cron que reprocesa.
  // Sólo aplica si subject_id/subject_type informados (sin ellos no
  // hay unicidad lógica).
  if (args.subject_type && args.subject_id) {
    try {
      const { count } = await admin
        .from("points_ledger")
        .select("id", { count: "exact", head: true })
        .eq("company_id", args.company_id)
        .eq("user_id", args.user_id)
        .eq("reason", args.reason)
        .eq("subject_type", args.subject_type)
        .eq("subject_id", args.subject_id)
        .gt("points", 0);
      if ((count ?? 0) > 0) {
        // Ya otorgado — log y salir sin insertar.
        console.log(
          `[awardPoints] skip duplicate ${args.reason} ${args.subject_type}=${args.subject_id} user=${args.user_id}`,
        );
        return;
      }
    } catch {
      /* fail-soft: si el SELECT falla, intentamos insertar igual */
    }
  }

  await admin.from("points_ledger").insert({
    company_id: args.company_id,
    user_id: args.user_id,
    points: Math.round(args.points),
    reason: args.reason,
    contract_id: args.contract_id ?? null,
    installation_id: args.installation_id ?? null,
    subject_type: args.subject_type ?? null,
    subject_id: args.subject_id ?? null,
    metadata: args.metadata ?? {},
    period_year: now.getFullYear(),
    period_month: now.getMonth() + 1,
    awarded_at: now.toISOString(),
  });
  // Comprobar hitos del mes (no recursivo: bonus de hito tiene reason
  // distinto y la función filtra para no contarse a sí mismo)
  if (args.points > 0 && args.reason !== "milestone_reached") {
    try {
      const { checkAndAwardMilestones } = await import("./milestones");
      await checkAndAwardMilestones(args.company_id, args.user_id);
    } catch {
      /* fail-soft */
    }
  }
}

/**
 * Anula puntos asociados a un subject (genera un asiento negativo del total
 * que ese subject había generado). Útil para cancelaciones.
 */
export async function reversePointsForSubject(
  companyId: string,
  subjectType: string,
  subjectId: string,
  reason: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prior } = await admin
    .from("points_ledger")
    .select("user_id, points")
    .eq("company_id", companyId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId);
  type Row = { user_id: string; points: number };
  // Agrupar por user_id
  const byUser = new Map<string, number>();
  for (const r of (prior ?? []) as Row[]) {
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.points);
  }
  const now = new Date();
  for (const [user_id, total] of byUser) {
    if (total === 0) continue;
    await admin.from("points_ledger").insert({
      company_id: companyId,
      user_id,
      points: -total,
      reason,
      subject_type: subjectType,
      subject_id: subjectId,
      period_year: now.getFullYear(),
      period_month: now.getMonth() + 1,
      awarded_at: now.toISOString(),
    });
  }
}
