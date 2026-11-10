import "server-only";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { enviarApns } from "./push-apns";
import { enviarFcm } from "./push-fcm";
import { avisarUnaVez, type AvisoPush, type ResultadoEnvioNativo } from "./push-tipos";

/**
 * Envía una notificación push a TODOS los dispositivos de un usuario, por los
 * tres canales a la vez (fan-out):
 *
 *   · push WEB   → public.push_subscriptions  (navegador / PWA, web-push + VAPID)
 *   · iPhone     → public.push_device_tokens  platform = 'ios'      (APNs directo)
 *   · Android    → public.push_device_tokens  platform = 'android'  (FCM HTTP v1)
 *
 * Variables de entorno:
 *   · Web:     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *              (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY para el botón de /perfil)
 *   · iPhone:  APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID  (ver push-apns.ts)
 *   · Android: FIREBASE_SERVICE_ACCOUNT_JSON           (ver push-fcm.ts)
 *
 * Cada canal es independiente: si faltan sus variables, ese canal no hace nada
 * y deja UN aviso en el log; los demás siguen. Nunca lanza: un fallo de push
 * no puede romper la notificación de la campana ni la acción que la disparó.
 *
 * La regla «solo category === 'alert'» y la deduplicación de 2 h viven en
 * notifier.ts, que es quien llama aquí.
 *
 * Este fichero ya NO es "use server": no debe poder llamarse desde el
 * navegador (permitiría mandar un push a cualquier usuario).
 */
export async function sendPushToUser(
  userId: string,
  payload: AvisoPush,
): Promise<{ sent: number; failed: number }> {
  if (!userId || !payload?.title) return { sent: 0, failed: 0 };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const [web, nativo] = await Promise.all([
      enviarWeb(admin, userId, payload).catch((e) => {
        console.warn("[push] fallo inesperado en push web:", mensaje(e));
        return { sent: 0, failed: 0 };
      }),
      enviarNativo(admin, userId, payload).catch((e) => {
        console.warn("[push] fallo inesperado en push nativo:", mensaje(e));
        return { sent: 0, failed: 0 };
      }),
    ]);
    return { sent: web.sent + nativo.sent, failed: web.failed + nativo.failed };
  } catch (e) {
    console.warn("[push] fallo inesperado:", mensaje(e));
    return { sent: 0, failed: 0 };
  }
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Push web (navegador / PWA)
// ---------------------------------------------------------------------------
async function enviarWeb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  payload: AvisoPush,
): Promise<{ sent: number; failed: number }> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    avisarUnaVez(
      "vapid-sin-config",
      "Push web sin configurar (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT): no se envía push al navegador.",
    );
    return { sent: 0, failed: 0 };
  }

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) {
    console.warn("[push] no se pudieron leer las suscripciones web:", error.message);
    return { sent: 0, failed: 0 };
  }
  type S = { id: string; endpoint: string; p256dh: string; auth: string };
  const lista = (subs ?? []) as S[];
  if (lista.length === 0) return { sent: 0, failed: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let webpush: any;
  try {
    const modulo = await import("web-push");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webpush = (modulo as any).default ?? modulo;
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e) {
    avisarUnaVez("vapid-mal", `web-push no arranca (${mensaje(e)}): revisa las claves VAPID.`);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const json = JSON.stringify(payload);
  await Promise.all(
    lista.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          { TTL: 12 * 3600, urgency: "high", timeout: 8000 },
        );
        sent += 1;
        await admin
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e: unknown) {
        failed += 1;
        // 404 / 410: el navegador dio de baja la suscripción → se borra.
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          console.warn(`[push] push web rechazado (${statusCode ?? mensaje(e)})`);
        }
      }
    }),
  );
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Push nativo (app de iOS y Android)
// ---------------------------------------------------------------------------
async function enviarNativo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  payload: AvisoPush,
): Promise<{ sent: number; failed: number }> {
  const { data, error } = await admin
    .from("push_device_tokens")
    .select("platform, token")
    .eq("user_id", userId);
  if (error) {
    // Lo normal: la migración 20261112090000 todavía no está aplicada.
    avisarUnaVez(
      "tokens-sin-tabla",
      `No se pudo leer push_device_tokens (${error.message}): ¿falta aplicar la migración? No se envía push a la app.`,
    );
    return { sent: 0, failed: 0 };
  }
  type T = { platform: "ios" | "android"; token: string };
  const lista = (data ?? []) as T[];
  if (lista.length === 0) return { sent: 0, failed: 0 };

  const [ios, android] = await Promise.all([
    enviarApns(
      lista.filter((t) => t.platform === "ios").map((t) => t.token),
      payload,
    ),
    enviarFcm(
      lista.filter((t) => t.platform === "android").map((t) => t.token),
      payload,
    ),
  ]);
  const resultados: ResultadoEnvioNativo[] = [...ios, ...android];

  const caducados = resultados.filter((r) => r.borrar).map((r) => r.token);
  if (caducados.length > 0) {
    // Se acota por usuario: si entre la lectura y el borrado el dispositivo
    // pasó a otra persona, su fila no se toca.
    const { error: errorBorrado } = await admin
      .from("push_device_tokens")
      .delete()
      .eq("user_id", userId)
      .in("token", caducados);
    if (errorBorrado) {
      console.warn("[push] no se pudieron borrar tokens caducados:", errorBorrado.message);
    }
  }

  return {
    sent: resultados.filter((r) => r.ok).length,
    failed: resultados.filter((r) => !r.ok).length,
  };
}
