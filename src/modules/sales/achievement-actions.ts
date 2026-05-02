"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface ObjectiveAchievement {
  id: string;
  scope_type: "department" | "user";
  scope_label: string;
  metric_kind: string;
  target_amount_cents: number | null;
  target_units: number | null;
  actual_amount_cents: number;
  actual_units: number;
  percent_amount: number | null;
  percent_units: number | null;
}

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

/**
 * Cruza monthly_objectives con sales_records y devuelve % de cumplimiento
 * por objetivo. metric_kind soportado:
 *  - cash_total          → suma total_cents donde plan_type='cash'
 *  - renting_total       → suma total_cents donde plan_type='renting'
 *  - rental_total        → suma total_cents donde plan_type='rental'
 *  - units               → count(*) de sales_records
 *  - financier_total     → suma financier_payment_cents
 *  - any_total           → suma total_cents
 */
export async function listObjectivesAchievement(
  year: number,
  month: number,
): Promise<ObjectiveAchievement[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const [{ data: objs }, { data: sales }] = await Promise.all([
    supabase
      .from("monthly_objectives")
      .select(
        "id, scope_type, scope_department, scope_user_id, metric_kind, target_amount_cents, target_units",
      )
      .eq("company_id", session.company_id)
      .eq("period_year", year)
      .eq("period_month", month),
    supabase
      .from("sales_records")
      .select(
        "sales_user_id, tmk_user_id, plan_type, total_cents, monthly_cents, financier_payment_cents",
      )
      .eq("company_id", session.company_id)
      .eq("period_year", year)
      .eq("period_month", month),
  ]);

  type Obj = {
    id: string;
    scope_type: "department" | "user";
    scope_department: string | null;
    scope_user_id: string | null;
    metric_kind: string;
    target_amount_cents: number | null;
    target_units: number | null;
  };
  type Sale = {
    sales_user_id: string | null;
    tmk_user_id: string | null;
    plan_type: string;
    total_cents: number;
    monthly_cents: number | null;
    financier_payment_cents: number | null;
  };
  const objList = (objs ?? []) as Obj[];
  const saleList = (sales ?? []) as Sale[];

  const userIds = Array.from(
    new Set(
      objList
        .filter((o) => o.scope_type === "user" && o.scope_user_id)
        .map((o) => o.scope_user_id as string),
    ),
  );
  const userNameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      userNameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }

  return objList.map((o): ObjectiveAchievement => {
    const filtered = saleList.filter((s) => {
      if (o.scope_type === "user") {
        return s.sales_user_id === o.scope_user_id || s.tmk_user_id === o.scope_user_id;
      }
      return true; // dpto: para simplicidad, todos los registros del mes (refinar con team_assignments)
    });

    let actualAmount = 0;
    let actualUnits = filtered.length;
    switch (o.metric_kind) {
      case "cash_total":
        actualAmount = filtered
          .filter((s) => s.plan_type === "cash")
          .reduce((a, b) => a + b.total_cents, 0);
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
        actualAmount = filtered.reduce(
          (a, b) => a + (b.financier_payment_cents ?? 0),
          0,
        );
        break;
      case "units":
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
        ? `Dpto ${DEPT_LABEL[o.scope_department ?? ""] ?? o.scope_department}`
        : userNameMap.get(o.scope_user_id ?? "") ?? "Usuario";

    return {
      id: o.id,
      scope_type: o.scope_type,
      scope_label: scopeLabel,
      metric_kind: o.metric_kind,
      target_amount_cents: o.target_amount_cents,
      target_units: o.target_units,
      actual_amount_cents: actualAmount,
      actual_units: actualUnits,
      percent_amount: percentAmount,
      percent_units: percentUnits,
    };
  });
}
