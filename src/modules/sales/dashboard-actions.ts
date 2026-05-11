"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Helpers de dashboard de objetivos por rol.
 *
 * Modelo de roles:
 *  - Nivel 1 (admin / directores): ve todo, puede filtrar por dpto y user
 *  - Nivel 2 (technical/commercial/telemarketing director sin admin): ve su dpto,
 *    sus nivel 3 individualmente y el global del equipo
 *  - Nivel 3 (sales_rep, telemarketer, installer): ve sólo lo suyo + global del equipo
 *
 * Usamos siempre lo que ya hay en BD (sales_records + monthly_objectives) sin
 * crear tablas nuevas.
 */

const DEPT_OF_ROLE: Record<string, "tech" | "sales" | "tmk"> = {
  technical_director: "tech",
  installer: "tech",
  commercial_director: "sales",
  sales_rep: "sales",
  telemarketing_director: "tmk",
  telemarketer: "tmk",
};

function getUserDepartment(roles: string[]): "tech" | "sales" | "tmk" | null {
  for (const r of roles) {
    const d = DEPT_OF_ROLE[r];
    if (d) return d;
  }
  return null;
}

function getUserLevel(roles: string[], isSuperadmin: boolean): 1 | 2 | 3 {
  if (isSuperadmin || roles.includes("company_admin")) return 1;
  if (
    roles.includes("technical_director") ||
    roles.includes("commercial_director") ||
    roles.includes("telemarketing_director")
  ) {
    return 2;
  }
  return 3;
}

export interface DashboardObjectivesResponse {
  level: 1 | 2 | 3;
  department: "tech" | "sales" | "tmk" | null;
  /** Mis objetivos individuales (vacío para nivel 1 si no es operativo) */
  individual: Array<ObjectiveProgress>;
  /** Objetivos del departamento (visibles a nivel 2 y 3) */
  department_objectives: Array<ObjectiveProgress>;
  /** Total mes en €, agregado al scope visible (mi venta para nivel 3, equipo para 2, todo para 1) */
  scope_month_total_cents: number;
  /** Total mes empresa (para mostrar también en cabecera) */
  company_month_total_cents: number;
}

export interface ObjectiveProgress {
  id: string;
  metric_kind: string;
  target_amount_cents: number | null;
  target_units: number | null;
  actual_amount_cents: number;
  actual_units: number;
  percent_amount: number | null;
  percent_units: number | null;
  scope_label: string;
}

export interface RankingRow {
  user_id: string;
  user_name: string;
  total_cents: number;
  units: number;
}


const EMPTY_DASHBOARD: DashboardObjectivesResponse = {
  level: 3,
  department: null,
  individual: [],
  department_objectives: [],
  scope_month_total_cents: 0,
  company_month_total_cents: 0,
};

export async function getDashboardObjectives(
  filterUserId?: string,
  filterDepartment?: "tech" | "sales" | "tmk",
): Promise<DashboardObjectivesResponse> {
  try {
    return await _getDashboardObjectives(filterUserId, filterDepartment);
  } catch (err) {
    console.error("[getDashboardObjectives]", err);
    return EMPTY_DASHBOARD;
  }
}

async function _getDashboardObjectives(
  filterUserId?: string,
  filterDepartment?: "tech" | "sales" | "tmk",
): Promise<DashboardObjectivesResponse> {
  const session = await requireSession();
  if (!session.company_id) {
    return EMPTY_DASHBOARD;
  }
  const level = getUserLevel(session.roles, session.is_superadmin);
  const myDept = getUserDepartment(session.roles);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Scope efectivo
  // - level 3: targetUserId = session.user_id, dept = myDept
  // - level 2: targetUserId opcional (filtrar por uno de sus nivel 3), dept = myDept
  // - level 1: todo libre
  let targetUserId: string | undefined;
  let targetDept: "tech" | "sales" | "tmk" | null = null;
  if (level === 3) {
    targetUserId = session.user_id;
    targetDept = myDept;
  } else if (level === 2) {
    targetUserId = filterUserId;
    targetDept = myDept;
  } else {
    targetUserId = filterUserId;
    targetDept = filterDepartment ?? null;
  }

  // ---- Sales records del mes ----
  const { data: salesRows } = await supabase
    .from("sales_records")
    .select("sales_user_id, tmk_user_id, plan_type, total_cents, financier_payment_cents")
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month);

  type Sale = {
    sales_user_id: string | null;
    tmk_user_id: string | null;
    plan_type: string;
    total_cents: number;
    financier_payment_cents: number | null;
  };
  const sales = (salesRows ?? []) as Sale[];

  const companyMonthTotal = sales.reduce((s, r) => s + r.total_cents, 0);

  // Filtrado del scope visible para "scope_month_total_cents"
  const scopeSales = sales.filter((s) => {
    if (targetUserId) {
      return s.sales_user_id === targetUserId || s.tmk_user_id === targetUserId;
    }
    return true; // toda la empresa o todo el dpto (no filtramos por dpto en sales_records porque no hay columna dpto, lo aproximamos)
  });
  const scopeMonthTotal = scopeSales.reduce((s, r) => s + r.total_cents, 0);

  // ---- Objetivos mes en curso ----
  let objQuery = supabase
    .from("monthly_objectives")
    .select(
      "id, scope_type, scope_department, scope_user_id, metric_kind, target_amount_cents, target_units",
    )
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month);

  // Para nivel 2/3 limitamos a su dpto
  if (level !== 1 && targetDept) {
    objQuery = objQuery.or(`scope_department.eq.${targetDept},scope_user_id.eq.${session.user_id}`);
  }
  const { data: objRows } = await objQuery;

  type Obj = {
    id: string;
    scope_type: "department" | "user";
    scope_department: string | null;
    scope_user_id: string | null;
    metric_kind: string;
    target_amount_cents: number | null;
    target_units: number | null;
  };
  const allObj = (objRows ?? []) as Obj[];

  // Resolver nombres de usuarios
  const userIds = Array.from(
    new Set(allObj.map((o) => o.scope_user_id).filter((v): v is string => !!v)),
  );
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }

  function calcProgress(o: Obj): ObjectiveProgress {
    const filtered =
      o.scope_type === "user"
        ? sales.filter(
            (s) => s.sales_user_id === o.scope_user_id || s.tmk_user_id === o.scope_user_id,
          )
        : sales; // dpto: aproximamos al total mes (no hay dpto en sales_records)

    let actualAmount = 0;
    let actualUnits = filtered.length;
    // monthly_objectives.metric_kind admite los enums `sales | contracts |
    // installations | recoveries` (definidos en la migración 121800). Los
    // antiguos `cash_total | renting_total | rental_total | financier_total |
    // units | any_total` se mantienen para retro-compatibilidad si alguien
    // editó la columna en BD directamente.
    switch (o.metric_kind) {
      case "cash_total":
        actualAmount = filtered.filter((s) => s.plan_type === "cash").reduce((a, b) => a + b.total_cents, 0);
        actualUnits = filtered.filter((s) => s.plan_type === "cash").length;
        break;
      case "renting_total":
        actualAmount = filtered
          .filter((s) => s.plan_type === "renting")
          .reduce((a, b) => a + b.total_cents, 0);
        actualUnits = filtered.filter((s) => s.plan_type === "renting").length;
        break;
      case "rental_total":
        actualAmount = filtered
          .filter((s) => s.plan_type === "rental")
          .reduce((a, b) => a + b.total_cents, 0);
        actualUnits = filtered.filter((s) => s.plan_type === "rental").length;
        break;
      case "financier_total":
        actualAmount = filtered.reduce((a, b) => a + (b.financier_payment_cents ?? 0), 0);
        break;
      case "units":
        actualAmount = 0;
        break;
      // Enums oficiales de monthly_objectives:
      case "sales":
      case "contracts":
        // Total facturado del periodo (todos los planes). El propio acto
        // de firmar contrato es lo que genera sales_records.
        actualAmount = filtered.reduce((a, b) => a + b.total_cents, 0);
        break;
      case "installations":
        // Métrica por unidades: cada sales_record cuenta como 1 venta /
        // instalación cerrada. No hay importe target esperable, solo
        // unidades.
        actualAmount = 0;
        break;
      case "recoveries":
        // Recuperaciones de leads o pruebas perdidas. Aún no hay tabla
        // dedicada → marcamos como 0 hasta que se implemente el módulo.
        actualAmount = 0;
        break;
      case "any_total":
      default:
        actualAmount = filtered.reduce((a, b) => a + b.total_cents, 0);
    }

    const percentAmount =
      o.target_amount_cents && o.target_amount_cents > 0
        ? Math.round((actualAmount * 100) / o.target_amount_cents)
        : null;
    const percentUnits =
      o.target_units && o.target_units > 0
        ? Math.round((actualUnits * 100) / o.target_units)
        : null;

    const scopeLabel =
      o.scope_type === "department"
        ? `Departamento`
        : nameMap.get(o.scope_user_id ?? "") ?? "Usuario";

    return {
      id: o.id,
      metric_kind: o.metric_kind,
      target_amount_cents: o.target_amount_cents,
      target_units: o.target_units,
      actual_amount_cents: actualAmount,
      actual_units: actualUnits,
      percent_amount: percentAmount,
      percent_units: percentUnits,
      scope_label: scopeLabel,
    };
  }

  // Individuales = scope_type=user y scope_user_id = session.user_id (siempre)
  // o si nivel 1/2 con filtro user, el filtrado
  const individualUserId = targetUserId ?? session.user_id;
  const individual = allObj
    .filter((o) => o.scope_type === "user" && o.scope_user_id === individualUserId)
    .map(calcProgress);

  // Departamento = scope_type=department del dpto correspondiente
  const departmentObjectives = allObj
    .filter(
      (o) =>
        o.scope_type === "department" &&
        (level === 1 ? (targetDept ? o.scope_department === targetDept : true) : o.scope_department === targetDept),
    )
    .map(calcProgress);

  return {
    level,
    department: targetDept ?? myDept,
    individual,
    department_objectives: departmentObjectives,
    scope_month_total_cents: scopeMonthTotal,
    company_month_total_cents: companyMonthTotal,
  };
}

/**
 * Ranking del mes por usuario (suma sales_records). Si filterDepartment se
 * pasa, intenta filtrar por usuarios del dpto vía user_roles.
 */
export async function getMonthRanking(
  filterDepartment?: "tech" | "sales" | "tmk",
): Promise<RankingRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: rows } = await supabase
    .from("sales_records")
    .select("sales_user_id, tmk_user_id, total_cents")
    .eq("company_id", session.company_id)
    .gte("recorded_at", monthStart);

  type S = { sales_user_id: string | null; tmk_user_id: string | null; total_cents: number };
  const list = (rows ?? []) as S[];

  // Aggregamos por sales_user_id (preferente), si null por tmk_user_id
  const map = new Map<string, { total: number; units: number }>();
  for (const r of list) {
    const key = r.sales_user_id ?? r.tmk_user_id;
    if (!key) continue;
    const cur = map.get(key) ?? { total: 0, units: 0 };
    cur.total += r.total_cents;
    cur.units += 1;
    map.set(key, cur);
  }

  // Filtrado por dpto: si pedimos dpto, listamos user_roles del dpto y restringimos
  if (filterDepartment) {
    const roleMap: Record<string, string[]> = {
      tech: ["technical_director", "installer"],
      sales: ["commercial_director", "sales_rep"],
      tmk: ["telemarketing_director", "telemarketer"],
    };
    const roleKeys = roleMap[filterDepartment]!;
    const { data: ur } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("company_id", session.company_id)
      .in("role_key", roleKeys)
      .is("revoked_at", null);
    const allowed = new Set(((ur ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
    for (const k of Array.from(map.keys())) {
      if (!allowed.has(k)) map.delete(k);
    }
  }

  const ids = Array.from(map.keys());
  const nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", ids);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }

  return ids
    .map((id) => ({
      user_id: id,
      user_name: nameMap.get(id) ?? id.slice(0, 8),
      total_cents: map.get(id)!.total,
      units: map.get(id)!.units,
    }))
    .sort((a, b) => b.total_cents - a.total_cents)
    .slice(0, 20);
}
