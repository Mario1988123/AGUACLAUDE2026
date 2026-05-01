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
  target_amount_cents: number | null;
  target_units: number | null;
}

export async function listObjectives(year: number, month: number): Promise<ObjectiveRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monthly_objectives")
    .select(
      "id, period_year, period_month, scope_type, scope_department, scope_user_id, metric_kind, target_amount_cents, target_units",
    )
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) throw error;
  return (data ?? []) as ObjectiveRow[];
}
