// Sin "use server" (auditoría 2026-10-01): son funciones internas que llaman
// otras acciones con el admin client. Como server actions cualquiera podía
// invocarlas desde el navegador con empresa, usuario y puntos arbitrarios.

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { DEFAULT_POINTS_SETTINGS, type PointsSettings } from "./settings";
import { mesMadrid } from "@/modules/scheduling/fechas-madrid";
import { isFunctionMissingError } from "@/modules/warehouses/adjust-stock";
import { yaOtorgado, type AsientoPuntos } from "./idempotencia";

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

  // Mes y año del asiento en hora de Madrid (auditoría 2026-10-01, I36): un
  // contrato firmado el 1-oct a las 01:30 de Madrid contaba para septiembre.
  const { anio: periodYear, mes: periodMonth } = mesMadrid(now);
  const points = Math.round(args.points);

  // Idempotencia ATÓMICA vía RPC award_points_once (auditoría 2026-10-01,
  // I43; migración 20261002090400): serializa por (empresa, usuario, motivo,
  // sujeto) y permite volver a otorgar tras una reversión.
  let inserted = false;
  const { data: rpcData, error: rpcErr } = await admin.rpc("award_points_once", {
    p_company_id: args.company_id,
    p_user_id: args.user_id,
    p_points: points,
    p_reason: args.reason,
    p_subject_type: args.subject_type ?? null,
    p_subject_id: args.subject_id ?? null,
    p_contract_id: args.contract_id ?? null,
    p_installation_id: args.installation_id ?? null,
    p_metadata: args.metadata ?? {},
    p_period_year: periodYear,
    p_period_month: periodMonth,
  });
  if (!rpcErr) {
    inserted = rpcData === true;
  } else if (isFunctionMissingError(rpcErr)) {
    // Migración sin aplicar: comprobación en código (sin bloqueo, como antes)
    // pero ya sin contar lo revertido.
    if (args.subject_type && args.subject_id) {
      const { data: previos, error: errPrev } = await admin
        .from("points_ledger")
        .select("points, reason, awarded_at")
        .eq("company_id", args.company_id)
        .eq("user_id", args.user_id)
        .eq("subject_type", args.subject_type)
        .eq("subject_id", args.subject_id);
      if (errPrev) {
        console.error("[awardPoints] points_ledger:", errPrev.message);
        return;
      }
      if (yaOtorgado((previos ?? []) as AsientoPuntos[], args.reason)) {
        console.log(
          `[awardPoints] skip duplicate ${args.reason} ${args.subject_type}=${args.subject_id} user=${args.user_id}`,
        );
        return;
      }
    }
    const { error: errIns } = await admin.from("points_ledger").insert({
      company_id: args.company_id,
      user_id: args.user_id,
      points,
      reason: args.reason,
      contract_id: args.contract_id ?? null,
      installation_id: args.installation_id ?? null,
      subject_type: args.subject_type ?? null,
      subject_id: args.subject_id ?? null,
      metadata: args.metadata ?? {},
      period_year: periodYear,
      period_month: periodMonth,
      awarded_at: now.toISOString(),
    });
    if (errIns) {
      console.error("[awardPoints] points_ledger insert:", errIns.message);
      return;
    }
    inserted = true;
  } else {
    // Fail-soft (contrato de esta función): no tumba el flujo principal.
    console.error("[awardPoints] award_points_once:", rpcErr.message);
    return;
  }
  if (!inserted) return;
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
        period_year: mesMadrid(now).anio,
      period_month: mesMadrid(now).mes,
      awarded_at: now.toISOString(),
    });
  }
}
