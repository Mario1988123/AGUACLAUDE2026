"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { categoryOfKind } from "./category-of-kind";

export interface NotificationRow {
  id: string;
  kind: string;
  category: "alert" | "event";
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  auto_resolved_at: string | null;
  created_at: string;
}

/**
 * Lista notificaciones del usuario actual. Devuelve `category` para que la
 * UI las separe en pestañas Alertas (accionables) / Eventos (informativos).
 *
 * Defensivo: si la columna `category` aún no existe en este entorno (migración
 * no aplicada), seleccionamos sin ella y aplicamos `categoryOfKind` en código.
 */
export async function listMyNotifications(): Promise<NotificationRow[]> {
  const session = await requireSession();
  const supabase = await createClient();
  try {
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, kind, category, severity, title, body, action_url, read_at, auto_resolved_at, created_at",
      )
      .eq("recipient_user_id", session.user_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as NotificationRow[];
  } catch {
    // Fallback sin column category — clasificamos en JS
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, severity, title, body, action_url, read_at, created_at")
      .eq("recipient_user_id", session.user_id)
      .order("created_at", { ascending: false })
      .limit(200);
    return ((data ?? []) as Array<Omit<NotificationRow, "category" | "auto_resolved_at">>).map(
      (n) => ({
        ...n,
        category: categoryOfKind(n.kind),
        auto_resolved_at: null,
      }),
    );
  }
}

/**
 * Cuenta para SSR inicial del bell. Mismo criterio que fetchUnreadCount:
 * SOLO category='alert' no leídas no resueltas.
 */
export async function getUnreadCount(): Promise<number> {
  const session = await requireSession();
  const supabase = await createClient();
  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", session.user_id)
      .eq("category", "alert")
      .is("read_at", null)
      .is("auto_resolved_at", null);
    if (error) throw error;
    return count ?? 0;
  } catch {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", session.user_id)
      .is("read_at", null);
    return count ?? 0;
  }
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

/**
 * Marca todas las notificaciones del usuario como leídas. Si se pasa
 * `category`, solo marca las de esa categoría (para no mezclar al hacer
 * "marcar todas" en la pestaña Alertas sin tocar Eventos, y viceversa).
 */
export async function markAllAsRead(category?: "alert" | "event") {
  const session = await requireSession();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() } as never)
    .eq("recipient_user_id", session.user_id)
    .is("read_at", null);
  if (category) {
    try {
      q = q.eq("category", category);
    } catch {
      /* fallback: si la columna no existe, marca todas */
    }
  }
  await q;
  revalidatePath("/notificaciones");
}

export async function markAllAsReadSafeAction(
  category?: "alert" | "event",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await markAllAsRead(category);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
