"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface SubjectNotification {
  id: string;
  title: string;
  body: string | null;
  severity: "info" | "success" | "warning" | "error";
  kind: string;
  created_at: string;
  read_at: string | null;
}

/** Devuelve las notificaciones SIN LEER y SIN AUTO-RESOLVER del usuario
 *  actual para un subject concreto (ej. incidencia X). Usado por las
 *  páginas destino para mostrar un toast/modal emergente al abrir. */
export async function getMyActiveNotificationsForSubject(
  subjectType: string,
  subjectId: string,
): Promise<SubjectNotification[]> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let res = await admin
    .from("notifications")
    .select("id, title, body, severity, kind, created_at, read_at, auto_resolved_at")
    .eq("recipient_user_id", session.user_id)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .is("read_at", null)
    .is("auto_resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (
    res.error &&
    /auto_resolved_at|schema cache|Could not find/i.test(res.error.message ?? "")
  ) {
    res = await admin
      .from("notifications")
      .select("id, title, body, severity, kind, created_at, read_at")
      .eq("recipient_user_id", session.user_id)
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
  }
  if (res.error) return [];
  return ((res.data ?? []) as SubjectNotification[]).filter(
    (n) => !n.read_at,
  );
}

/** Marca como auto-resolved todas las notificaciones de un subject.
 *  Se llama desde las actions que resuelven la entidad (cerrar
 *  incidencia, completar instalación, aprobar ausencia, etc.).
 *  No bloquea — fail-soft. */
export async function autoResolveNotificationsForSubject(
  subjectType: string,
  subjectId: string,
  reason: string,
): Promise<void> {
  try {
    // SEGURIDAD: server action exportada → exigir sesión y filtrar por company_id
    // (si no, se podrían resolver notificaciones de un subject de otra empresa).
    const session = await requireSession();
    if (!session.company_id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const now = new Date().toISOString();
    const res = await admin
      .from("notifications")
      .update({ auto_resolved_at: now, resolved_reason: reason })
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .eq("company_id", session.company_id)
      .is("read_at", null)
      .is("auto_resolved_at", null);
    if (
      res.error &&
      /auto_resolved_at|resolved_reason|schema cache|Could not find/i.test(
        res.error.message ?? "",
      )
    ) {
      // Fallback: marcar como read si la columna nueva no existe
      await admin
        .from("notifications")
        .update({ read_at: now })
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .eq("company_id", session.company_id)
        .is("read_at", null);
    }
  } catch {
    /* no-op */
  }
}

/** Marca como leída una notificación concreta cuando el usuario la ve
 *  en el toast/modal del destino. */
export async function markNotificationReadAction(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("recipient_user_id", session.user_id);
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
