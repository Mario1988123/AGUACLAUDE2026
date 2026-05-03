"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface MonthlyEvolutionRow {
  year: number;
  month: number;
  label: string; // "Ene 25"
  contracts: number;
  leads: number;
  sales_cents: number;
}

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/**
 * Devuelve los últimos 12 meses (incluyendo el actual) con conteos de
 * leads creados, contratos firmados y suma de € de contratos.
 */
export async function getMonthlyEvolution(): Promise<MonthlyEvolutionRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const now = new Date();
  const buckets: MonthlyEvolutionRow[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
      contracts: 0,
      leads: 0,
      sales_cents: 0,
    });
  }
  const oldestStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

  const [{ data: leads }, { data: contracts }] = await Promise.all([
    supabase
      .from("leads")
      .select("created_at")
      .eq("company_id", session.company_id)
      .gte("created_at", oldestStart)
      .is("deleted_at", null)
      .limit(20000),
    supabase
      .from("contracts")
      .select("signed_at, total_cash_cents, monthly_cents, duration_months")
      .eq("company_id", session.company_id)
      .gte("signed_at", oldestStart)
      .not("signed_at", "is", null)
      .is("deleted_at", null)
      .limit(20000),
  ]);

  function bucketFor(iso: string): MonthlyEvolutionRow | null {
    const d = new Date(iso);
    return (
      buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth() + 1) ?? null
    );
  }
  for (const r of (leads ?? []) as Array<{ created_at: string }>) {
    const b = bucketFor(r.created_at);
    if (b) b.leads += 1;
  }
  for (const r of (contracts ?? []) as Array<{
    signed_at: string;
    total_cash_cents: number | null;
    monthly_cents: number | null;
    duration_months: number | null;
  }>) {
    const b = bucketFor(r.signed_at);
    if (b) {
      b.contracts += 1;
      const value =
        r.total_cash_cents ??
        (r.monthly_cents != null ? r.monthly_cents * (r.duration_months ?? 12) : 0);
      b.sales_cents += value;
    }
  }
  return buckets;
}
