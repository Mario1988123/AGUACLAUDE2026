"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface SalesRow {
  id: string;
  contract_id: string;
  sales_user_id: string | null;
  tmk_user_id: string | null;
  installer_user_id: string | null;
  plan_type: string;
  total_cents: number;
  monthly_cents: number | null;
  duration_months: number | null;
  financier_payment_cents: number | null;
  period_year: number;
  period_month: number;
  recorded_at: string;
}

export async function listSales(year?: number, month?: number): Promise<SalesRow[]> {
  await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("sales_records")
    .select(
      "id, contract_id, sales_user_id, tmk_user_id, installer_user_id, plan_type, total_cents, monthly_cents, duration_months, financier_payment_cents, period_year, period_month, recorded_at",
    )
    .order("recorded_at", { ascending: false })
    .limit(500);
  if (year) query = query.eq("period_year", year);
  if (month) query = query.eq("period_month", month);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SalesRow[];
}

export interface ObjectiveRow {
  id: string;
  period_year: number;
  period_month: number;
  scope_type: "department" | "user";
  scope_department: string | null;
  scope_user_id: string | null;
  metric_kind: string;
  /** Fase 2: null = cualquier tipo de venta. */
  plan_type: "cash" | "rental" | "renting" | null;
  target_amount_cents: number | null;
  target_units: number | null;
}

export async function listObjectives(year: number, month: number): Promise<ObjectiveRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // SELECT defensivo: si plan_type no existe en el cache, caemos al
  // subset legacy y derivamos null.
  const FULL =
    "id, period_year, period_month, scope_type, scope_department, scope_user_id, metric_kind, plan_type, target_amount_cents, target_units";
  const LEGACY =
    "id, period_year, period_month, scope_type, scope_department, scope_user_id, metric_kind, target_amount_cents, target_units";
  let res = await supabase
    .from("monthly_objectives")
    .select(FULL)
    .eq("period_year", year)
    .eq("period_month", month);
  if (
    res.error &&
    /plan_type|schema cache|Could not find/i.test(res.error.message ?? "")
  ) {
    res = await supabase
      .from("monthly_objectives")
      .select(LEGACY)
      .eq("period_year", year)
      .eq("period_month", month);
  }
  if (res.error) throw res.error;
  return ((res.data ?? []) as Array<Partial<ObjectiveRow>>).map((r) => ({
    id: r.id!,
    period_year: r.period_year!,
    period_month: r.period_month!,
    scope_type: r.scope_type!,
    scope_department: r.scope_department ?? null,
    scope_user_id: r.scope_user_id ?? null,
    metric_kind: r.metric_kind ?? "sales",
    plan_type: (r.plan_type ?? null) as ObjectiveRow["plan_type"],
    target_amount_cents: r.target_amount_cents ?? null,
    target_units: r.target_units ?? null,
  }));
}
