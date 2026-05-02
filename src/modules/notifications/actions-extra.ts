"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/** Solo cuenta — para polling ligero del badge en header. */
export async function fetchUnreadCount(): Promise<number> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", session.user_id)
    .is("read_at", null);
  return count ?? 0;
}
