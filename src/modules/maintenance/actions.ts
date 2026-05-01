"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface MaintenanceRow {
  id: string;
  status: string;
  kind: string;
  customer_id: string;
  customer_name: string | null;
  technician_user_id: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  is_charged: boolean;
  charge_cents: number | null;
}

export async function listMaintenance(): Promise<MaintenanceRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("maintenance_jobs")
    .select(
      "id, status, kind, customer_id, technician_user_id, scheduled_at, completed_at, is_charged, charge_cents",
    )
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (
    session.roles.includes("installer") &&
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("technical_director")
  ) {
    query = query.eq("technician_user_id", session.user_id);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<MaintenanceRow, "customer_name">>;
  const ids = Array.from(new Set(rows.map((r) => r.customer_id)));
  let nameMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", ids);
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
  return rows.map((r) => ({ ...r, customer_name: nameMap.get(r.customer_id) ?? null }));
}
