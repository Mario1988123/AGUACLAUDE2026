"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface WalletEntryRow {
  id: string;
  concept: string;
  amount_cents: number;
  method: string;
  status: string;
  collected_by_user_id: string | null;
  collected_at: string | null;
  validated_at: string | null;
  contract_id: string | null;
  created_at: string;
}

export async function listWalletEntries(): Promise<WalletEntryRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("wallet_entries")
    .select(
      "id, concept, amount_cents, method, status, collected_by_user_id, collected_at, validated_at, contract_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
  ) {
    query = query.eq("collected_by_user_id", session.user_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WalletEntryRow[];
}

export async function getWalletSummary() {
  const session = await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wallet_entries")
    .select("status, amount_cents, collected_by_user_id");
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    status: string;
    amount_cents: number;
    collected_by_user_id: string | null;
  }>;
  const filtered =
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director")
      ? rows.filter((r) => r.collected_by_user_id === session.user_id)
      : rows;
  const sum = (st: string) =>
    filtered.filter((r) => r.status === st).reduce((s, r) => s + r.amount_cents, 0);
  return {
    pending_cents: sum("pending"),
    collected_cents: sum("collected"),
    pending_settlement_cents: sum("pending_settlement"),
    settled_cents: sum("settled"),
    validated_cents: sum("validated"),
  };
}
