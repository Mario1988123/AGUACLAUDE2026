"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

const DEPT_ROLE: Record<string, "tech" | "sales" | "tmk"> = {
  technical_director: "tech",
  installer: "tech",
  commercial_director: "sales",
  sales_rep: "sales",
  telemarketing_director: "tmk",
  telemarketer: "tmk",
};

const ROLES_BY_DEPT: Record<"tech" | "sales" | "tmk", string[]> = {
  tech: ["technical_director", "installer"],
  sales: ["commercial_director", "sales_rep"],
  tmk: ["telemarketing_director", "telemarketer"],
};

export interface PointsRankingRow {
  user_id: string;
  user_name: string;
  department: "tech" | "sales" | "tmk" | null;
  points_month: number;
  points_year: number;
  /** Equipos asociados al usuario este mes (suma metadata.equipments en
   *  asientos sale / sale_with_discount / sale_tmk_split). Para tech
   *  habitualmente 0; para comerciales y TMK refleja su producción. Se
   *  expone a todos: es agregado sin revelar contratos concretos. */
  equipments_month: number;
}

interface RankingArgs {
  scope: "all" | "department" | "team";
  /** Si scope=department: dpto a filtrar */
  department?: "tech" | "sales" | "tmk";
  /** Si scope=team (nivel 2): user_ids del equipo */
  user_ids?: string[];
  /** Año/mes para el cálculo, default mes actual */
  year?: number;
  month?: number;
}

/**
 * Devuelve el ranking de puntos agregado mes y año por usuario.
 */
export async function getPointsRanking(args: RankingArgs): Promise<PointsRankingRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const year = args.year ?? now.getFullYear();
  const month = args.month ?? now.getMonth() + 1;

  // 1) Obtener usuarios candidatos según scope
  let candidateIds: string[] | null = null;
  if (args.scope === "department" && args.department) {
    const roles = ROLES_BY_DEPT[args.department];
    const { data: ur } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id)
      .in("role_key", roles)
      .is("revoked_at", null);
    candidateIds = Array.from(
      new Set(((ur ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
    );
  } else if (args.scope === "team" && args.user_ids) {
    candidateIds = args.user_ids;
  }

  // 2) Sumas mes y año + equipos vendidos del mes
  const monthQ = supabase
    .from("points_ledger")
    .select("user_id, points")
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month);
  const yearQ = supabase
    .from("points_ledger")
    .select("user_id, points")
    .eq("company_id", session.company_id)
    .eq("period_year", year);
  // Equipos vendidos: asientos de venta del mes con metadata.equipments
  const equipQ = supabase
    .from("points_ledger")
    .select("user_id, metadata, reason")
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month)
    .in("reason", ["sale", "sale_with_discount", "sale_tmk_split"]);
  const [{ data: monthData }, { data: yearData }, { data: equipData }] =
    await Promise.all([
      candidateIds && candidateIds.length > 0 ? monthQ.in("user_id", candidateIds) : monthQ,
      candidateIds && candidateIds.length > 0 ? yearQ.in("user_id", candidateIds) : yearQ,
      candidateIds && candidateIds.length > 0 ? equipQ.in("user_id", candidateIds) : equipQ,
    ]);

  type Row = { user_id: string; points: number };
  const monthMap = new Map<string, number>();
  for (const r of (monthData ?? []) as Row[]) {
    monthMap.set(r.user_id, (monthMap.get(r.user_id) ?? 0) + r.points);
  }
  const yearMap = new Map<string, number>();
  for (const r of (yearData ?? []) as Row[]) {
    yearMap.set(r.user_id, (yearMap.get(r.user_id) ?? 0) + r.points);
  }
  // metadata es JSONB → puede venir como string si la lib no lo parsea.
  // Defensivo: aceptamos string|object y extraemos .equipments numérico.
  const equipMap = new Map<string, number>();
  type EquipRow = {
    user_id: string;
    reason: string;
    metadata: Record<string, unknown> | string | null;
  };
  for (const r of (equipData ?? []) as EquipRow[]) {
    let meta: Record<string, unknown> | null = null;
    if (r.metadata && typeof r.metadata === "object") {
      meta = r.metadata as Record<string, unknown>;
    } else if (typeof r.metadata === "string") {
      try {
        meta = JSON.parse(r.metadata);
      } catch {
        meta = null;
      }
    }
    const n = meta && typeof meta.equipments === "number" ? meta.equipments : 0;
    if (n > 0) equipMap.set(r.user_id, (equipMap.get(r.user_id) ?? 0) + n);
  }

  // Set final de ids: union de candidatos + quienes tengan puntos
  const allIds = new Set<string>();
  if (candidateIds) candidateIds.forEach((id) => allIds.add(id));
  monthMap.forEach((_, id) => allIds.add(id));
  yearMap.forEach((_, id) => allIds.add(id));
  if (allIds.size === 0) return [];

  // 3) Resolver nombres + departamentos
  const ids = Array.from(allIds);
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase.from("user_profiles").select("user_id, full_name").in("user_id", ids),
    supabase
      .from("user_roles")
      .select("user_id, role_key")
      .in("user_id", ids)
      .eq("company_id", session.company_id)
      .is("revoked_at", null),
  ]);
  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
    nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
  }
  const deptMap = new Map<string, "tech" | "sales" | "tmk">();
  for (const r of (roles ?? []) as Array<{ user_id: string; role_key: string }>) {
    const d = DEPT_ROLE[r.role_key];
    if (d && !deptMap.has(r.user_id)) deptMap.set(r.user_id, d);
  }

  return ids
    .map((id) => ({
      user_id: id,
      user_name: nameMap.get(id) ?? id.slice(0, 8),
      department: deptMap.get(id) ?? null,
      points_month: monthMap.get(id) ?? 0,
      points_year: yearMap.get(id) ?? 0,
      equipments_month: equipMap.get(id) ?? 0,
    }))
    .sort((a, b) => b.points_month - a.points_month);
}

export async function getMyPoints(): Promise<{ month: number; year: number }> {
  const session = await requireSession();
  if (!session.company_id) return { month: 0, year: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  const { data: monthRows } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .eq("period_year", y)
    .eq("period_month", m);
  const { data: yearRows } = await supabase
    .from("points_ledger")
    .select("points")
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .eq("period_year", y);

  const month = ((monthRows ?? []) as Array<{ points: number }>).reduce(
    (s, r) => s + r.points,
    0,
  );
  const year = ((yearRows ?? []) as Array<{ points: number }>).reduce(
    (s, r) => s + r.points,
    0,
  );
  return { month, year };
}
