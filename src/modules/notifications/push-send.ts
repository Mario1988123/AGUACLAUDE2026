"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Envía notificación push a un usuario. Requiere:
 *   · VAPID_PUBLIC_KEY  (también expuesta como NEXT_PUBLIC_VAPID_PUBLIC_KEY)
 *   · VAPID_PRIVATE_KEY
 *   · VAPID_SUBJECT (mailto: o https:)
 *
 * Si web-push no está instalado o falta config, no-op silencioso —
 * el sistema sigue usando las notificaciones in-app (campanita).
 *
 * Decisión 2026-05-20: implementación lista. Para activar, el admin
 * debe generar VAPID keys (npx web-push generate-vapid-keys) y meterlas
 * en env vars de Vercel.
 */
export async function sendPushToUser(
  userId: string,
  payload: {
    title: string;
    body?: string;
    url?: string;
    tag?: string;
    icon?: string;
  },
): Promise<{ sent: number; failed: number }> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return { sent: 0, failed: 0 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let webpush: any;
  try {
    webpush = await import("web-push");
  } catch {
    // Librería no presente (no debería pasar — está en package.json).
    return { sent: 0, failed: 0 };
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  type S = { id: string; endpoint: string; p256dh: string; auth: string };
  const list = (subs ?? []) as S[];

  let sent = 0;
  let failed = 0;
  const json = JSON.stringify(payload);
  for (const s of list) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        json,
      );
      sent += 1;
      await admin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", s.id);
    } catch (e: unknown) {
      failed += 1;
      // Si el endpoint devuelve 410 (gone) o 404, lo borramos.
      const statusCode = (e as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }
  return { sent, failed };
}
