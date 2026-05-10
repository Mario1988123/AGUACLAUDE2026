"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface CascadeUser {
  user_id: string;
  full_name: string;
  user_target_amount_cents: number | null;
  user_target_units: number | null;
  user_actual_amount_cents: number;
  user_actual_units: number;
  user_objective_id: string | null;
}

export interface CascadeDept {
  department: "sales" | "tech" | "tmk";
  department_label: string;
  // Objetivo informativo de nivel 1 (admin)
  dept_target_amount_cents: number | null;
  dept_target_units: number | null;
  dept_objective_id: string | null;
  // Suma de objetivos asignados a usuarios del dept (cascada nivel 2)
  distributed_amount_cents: number;
  distributed_units: number;
  // Realizado del mes
  actual_amount_cents: number;
  actual_units: number;
  // Usuarios del dept
  users: CascadeUser[];
}

const DEPT_LABEL: Record<string, string> = {
  sales: "Comercial",
  tech: "Técnico",
  tmk: "Telemarketing",
};

const DEPT_LIST: Array<"sales" | "tech" | "tmk"> = ["sales", "tech", "tmk"];

/**
 * Construye la vista en cascada de objetivos para un mes:
 *  - 3 deptos: sales, tech, tmk.
 *  - Por cada dept: target informativo nivel 1, suma distribuida nivel 2,
 *    realizado actual, y lista de usuarios del dept con sus targets/actuals.
 *
 * Métrica única simplificada: 'sales' (total_cents) + 'units' (count).
 * Para el primer release de la cascada visual.
 */
export async function getObjectivesCascade(
  year: number,
  month: number,
): Promise<CascadeDept[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Cargar objetivos del mes
  const { data: objsRaw } = await admin
    .from("monthly_objectives")
    .select(
      "id, scope_type, scope_department, scope_user_id, metric_kind, target_amount_cents, target_units",
    )
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month)
    .eq("metric_kind", "sales");
  type Obj = {
    id: string;
    scope_type: "department" | "user";
    scope_department: "sales" | "tech" | "tmk" | null;
    scope_user_id: string | null;
    metric_kind: string;
    target_amount_cents: number | null;
    target_units: number | null;
  };
  const objs = (objsRaw ?? []) as Obj[];
  const deptObjMap = new Map<string, Obj>();
  const userObjMap = new Map<string, Obj>();
  for (const o of objs) {
    if (o.scope_type === "department" && o.scope_department) {
      deptObjMap.set(o.scope_department, o);
    } else if (o.scope_type === "user" && o.scope_user_id) {
      userObjMap.set(o.scope_user_id, o);
    }
  }

  // 2) Cargar usuarios por departamento. roles_catalog tiene
  // default_department; user_roles enlaza users con role_key.
  const { data: userRolesRaw } = await admin
    .from("user_roles")
    .select("user_id, role_key, revoked_at")
    .eq("company_id", session.company_id)
    .is("revoked_at", null);
  type UR = { user_id: string; role_key: string; revoked_at: string | null };
  const userRoles = (userRolesRaw ?? []) as UR[];
  const allUserIds = Array.from(new Set(userRoles.map((u) => u.user_id)));

  const { data: rolesCatalogRaw } = await admin
    .from("roles_catalog")
    .select("key, default_department");
  type RC = { key: string; default_department: string | null };
  const roleDept = new Map(
    ((rolesCatalogRaw ?? []) as RC[]).map((r) => [r.key, r.default_department]),
  );

  // Profile names
  const { data: profiles } = await admin
    .from("user_profiles")
    .select("user_id, full_name")
    .in("user_id", allUserIds);
  const nameMap = new Map(
    ((profiles ?? []) as Array<{ user_id: string; full_name: string | null }>).map(
      (p) => [p.user_id, p.full_name ?? p.user_id.slice(0, 8)],
    ),
  );

  // user → set of departments where they belong (un usuario puede tener
  // varios roles, ej. comercial + admin)
  const userDepts = new Map<string, Set<string>>();
  for (const ur of userRoles) {
    const dept = roleDept.get(ur.role_key);
    if (!dept) continue;
    if (!userDepts.has(ur.user_id)) userDepts.set(ur.user_id, new Set());
    userDepts.get(ur.user_id)!.add(dept);
  }

  // 3) Cargar sales del mes para calcular actuals
  const { data: salesRaw } = await admin
    .from("sales_records")
    .select("sales_user_id, tmk_user_id, installer_user_id, total_cents")
    .eq("company_id", session.company_id)
    .eq("period_year", year)
    .eq("period_month", month);
  type Sale = {
    sales_user_id: string | null;
    tmk_user_id: string | null;
    installer_user_id: string | null;
    total_cents: number;
  };
  const sales = (salesRaw ?? []) as Sale[];

  function actualForUser(userId: string): { amount: number; units: number } {
    const filtered = sales.filter(
      (s) =>
        s.sales_user_id === userId ||
        s.tmk_user_id === userId ||
        s.installer_user_id === userId,
    );
    return {
      amount: filtered.reduce((a, b) => a + b.total_cents, 0),
      units: filtered.length,
    };
  }

  function actualForDept(dept: string): { amount: number; units: number } {
    // Filtramos sales records cuyo sales_user/tmk_user/installer_user
    // pertenece al dept en cuestión.
    const filtered = sales.filter((s) => {
      const ids = [s.sales_user_id, s.tmk_user_id, s.installer_user_id].filter(
        Boolean,
      ) as string[];
      return ids.some((id) => userDepts.get(id)?.has(dept));
    });
    return {
      amount: filtered.reduce((a, b) => a + b.total_cents, 0),
      units: filtered.length,
    };
  }

  // 4) Construir resultado
  return DEPT_LIST.map((dept) => {
    const deptObj = deptObjMap.get(dept) ?? null;
    const usersInDept = Array.from(userDepts.entries())
      .filter(([_, depts]) => depts.has(dept))
      .map(([uid]) => uid);

    const userRows: CascadeUser[] = usersInDept
      .map((uid) => {
        const userObj = userObjMap.get(uid) ?? null;
        const actual = actualForUser(uid);
        return {
          user_id: uid,
          full_name: nameMap.get(uid) ?? "?",
          user_target_amount_cents: userObj?.target_amount_cents ?? null,
          user_target_units: userObj?.target_units ?? null,
          user_actual_amount_cents: actual.amount,
          user_actual_units: actual.units,
          user_objective_id: userObj?.id ?? null,
        };
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const distributedAmount = userRows.reduce(
      (s, u) => s + (u.user_target_amount_cents ?? 0),
      0,
    );
    const distributedUnits = userRows.reduce(
      (s, u) => s + (u.user_target_units ?? 0),
      0,
    );

    const actualDept = actualForDept(dept);

    return {
      department: dept,
      department_label: DEPT_LABEL[dept] ?? dept,
      dept_target_amount_cents: deptObj?.target_amount_cents ?? null,
      dept_target_units: deptObj?.target_units ?? null,
      dept_objective_id: deptObj?.id ?? null,
      distributed_amount_cents: distributedAmount,
      distributed_units: distributedUnits,
      actual_amount_cents: actualDept.amount,
      actual_units: actualDept.units,
      users: userRows,
    };
  });
}

/**
 * Atajo upsert que NO requiere conocer el id previo del objetivo:
 * usa unique constraint para reemplazar.
 */
export async function setDeptObjective(input: {
  year: number;
  month: number;
  department: "sales" | "tech" | "tmk";
  target_amount_cents: number | null;
  target_units: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin")
    ) {
      return { ok: false, error: "Solo nivel 1 (admin) define objetivos por dpto" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: existing } = await admin
      .from("monthly_objectives")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("period_year", input.year)
      .eq("period_month", input.month)
      .eq("scope_type", "department")
      .eq("scope_department", input.department)
      .eq("metric_kind", "sales")
      .maybeSingle();
    const payload = {
      company_id: session.company_id,
      period_year: input.year,
      period_month: input.month,
      scope_type: "department",
      scope_department: input.department,
      scope_user_id: null,
      metric_kind: "sales",
      target_amount_cents: input.target_amount_cents,
      target_units: input.target_units,
      set_by_user_id: session.user_id,
    };
    if (existing) {
      await admin
        .from("monthly_objectives")
        .update(payload)
        .eq("id", (existing as { id: string }).id);
    } else {
      await admin.from("monthly_objectives").insert(payload);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function setUserObjective(input: {
  year: number;
  month: number;
  user_id: string;
  department: "sales" | "tech" | "tmk";
  target_amount_cents: number | null;
  target_units: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("commercial_director") &&
      !session.roles.includes("technical_director") &&
      !session.roles.includes("telemarketing_director")
    ) {
      return { ok: false, error: "Solo nivel 1/2 puede asignar objetivos" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Buscar el dept_objective como parent
    const { data: parentDept } = await admin
      .from("monthly_objectives")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("period_year", input.year)
      .eq("period_month", input.month)
      .eq("scope_type", "department")
      .eq("scope_department", input.department)
      .eq("metric_kind", "sales")
      .maybeSingle();
    const parentId = (parentDept as { id: string } | null)?.id ?? null;

    const { data: existing } = await admin
      .from("monthly_objectives")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("period_year", input.year)
      .eq("period_month", input.month)
      .eq("scope_type", "user")
      .eq("scope_user_id", input.user_id)
      .eq("metric_kind", "sales")
      .maybeSingle();

    const payload = {
      company_id: session.company_id,
      period_year: input.year,
      period_month: input.month,
      scope_type: "user",
      scope_department: null,
      scope_user_id: input.user_id,
      parent_objective_id: parentId,
      metric_kind: "sales",
      target_amount_cents: input.target_amount_cents,
      target_units: input.target_units,
      set_by_user_id: session.user_id,
    };
    if (existing) {
      await admin
        .from("monthly_objectives")
        .update(payload)
        .eq("id", (existing as { id: string }).id);
    } else {
      await admin.from("monthly_objectives").insert(payload);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// Asegurar que el server file solo exporta async
export type { CascadeUser as _CU, CascadeDept as _CD };

// Helper sin "use server" no se puede definir aquí; lo dejamos como const
// dentro del componente cliente. El listado de departamentos lo importan
// las pantallas vía constante local.
const _DEPT_LIST_REF = DEPT_LIST;
void _DEPT_LIST_REF;

// Cargar el dept del usuario actual (para nivel 2 saber qué dept distribuye)
export async function getMyDepartments(): Promise<("sales" | "tech" | "tmk")[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("role_key")
    .eq("company_id", session.company_id)
    .eq("user_id", session.user_id)
    .is("revoked_at", null);
  const keys = ((userRoles ?? []) as Array<{ role_key: string }>).map(
    (r) => r.role_key,
  );
  const { data: roles } = await supabase
    .from("roles_catalog")
    .select("key, default_department")
    .in("key", keys);
  const depts = new Set<"sales" | "tech" | "tmk">();
  for (const r of (roles ?? []) as Array<{
    key: string;
    default_department: "sales" | "tech" | "tmk" | null;
  }>) {
    if (r.default_department) depts.add(r.default_department);
  }
  return Array.from(depts);
}
