"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface InstallationRow {
  id: string;
  reference_code: string | null;
  status: string;
  kind: string;
  installer_user_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function listInstallations(): Promise<InstallationRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("installations")
    .select(
      "id, reference_code, status, kind, installer_user_id, customer_id, scheduled_at, started_at, completed_at, created_at",
    )
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);

  if (
    session.roles.includes("installer") &&
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    query = query
      .eq("installer_user_id", session.user_id)
      .not("status", "in", "(completed,cancelled)");
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<Omit<InstallationRow, "customer_name">>;
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
  );
  let nameMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    type CC = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
    };
    nameMap = new Map(
      ((cs ?? []) as CC[]).map((c) => [
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Sin nombre"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
      ]),
    );
  }
  return rows.map((r) => ({
    ...r,
    customer_name: r.customer_id ? nameMap.get(r.customer_id) ?? null : null,
  }));
}
