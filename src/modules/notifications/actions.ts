"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface NotificationRow {
  id: string;
  kind: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listMyNotifications(): Promise<NotificationRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, severity, title, body, action_url, read_at, created_at")
    .eq("recipient_user_id", session.user_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function getUnreadCount(): Promise<number> {
  const session = await requireSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", session.user_id)
    .is("read_at", null);
  return count ?? 0;
}

export async function markAsRead(id: string) {
  await requireSession();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", id);
  revalidatePath("/notificaciones");
}

export async function markAllAsRead() {
  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .eq("recipient_user_id", session.user_id)
    .is("read_at", null);
  revalidatePath("/notificaciones");
}
