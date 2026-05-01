"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface IncidentRow {
  id: string;
  reference_code: string | null;
  title: string;
  status: string;
  priority: string;
  origin: string;
  assigned_user_id: string | null;
  customer_id: string | null;
  created_at: string;
}

export async function listIncidents(): Promise<IncidentRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incidents")
    .select(
      "id, reference_code, title, status, priority, origin, assigned_user_id, customer_id, created_at",
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as IncidentRow[];
}
