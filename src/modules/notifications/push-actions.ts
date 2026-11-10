"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";

/**
 * Persiste una nueva push subscription para el usuario actual.
 * Idempotente por endpoint: si ya existe, actualiza last_used_at.
 */
export async function registerPushSubscriptionAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!input.endpoint || !input.p256dh || !input.auth) {
      return { ok: false, error: "Datos de suscripción incompletos" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // ¿Existe ya este endpoint? Actualizar.
    const { data: existing } = await admin
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", input.endpoint)
      .maybeSingle();
    if (existing) {
      await admin
        .from("push_subscriptions")
        .update({
          user_id: session.user_id,
          company_id: session.company_id,
          p256dh: input.p256dh,
          auth: input.auth,
          user_agent: input.user_agent ?? null,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", (existing as { id: string }).id);
      return { ok: true };
    }
    const { error } = await admin.from("push_subscriptions").insert({
      user_id: session.user_id,
      company_id: session.company_id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.user_agent ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Elimina una push subscription (al hacer unsubscribe en el navegador).
 */
export async function unregisterPushSubscriptionAction(
  endpoint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", session.user_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// ============================================================================
// Push NATIVO (app de iOS y Android): tokens de dispositivo
// ============================================================================

/** Cookie httpOnly con el token de este dispositivo. La lee /logout para dar
 *  de baja el token al cerrar sesión, sin depender de JavaScript. */
const COOKIE_TOKEN_DISPOSITIVO = "hm_push_token";

// APNs: hexadecimal (hoy 64 caracteres; Apple avisa de que puede crecer).
const TOKEN_IOS = /^[0-9a-fA-F]{64,256}$/;
// FCM: letras, cifras, ":", "_" y "-" (suele rondar los 140-180 caracteres).
const TOKEN_ANDROID = /^[A-Za-z0-9_:\-]{64,4096}$/;
const VERSION_APP = /^\d{1,4}(\.\d{1,4}){0,3}$/;

function tokenValido(plataforma: "ios" | "android", token: string): boolean {
  return plataforma === "ios" ? TOKEN_IOS.test(token) : TOKEN_ANDROID.test(token);
}

/**
 * Guarda (o refresca) el token de push de ESTE dispositivo para el usuario de
 * la sesión. Lo llama la app al iniciar sesión y en cada arranque.
 *
 * · El usuario y la empresa salen SIEMPRE de la sesión, nunca del cliente.
 * · Idempotente por token: si el móvil pasa a otra persona, la fila se
 *   reasigna a ella (y deja de recibir los avisos de la anterior).
 */
export async function registrarTokenDispositivoAction(input: {
  plataforma: "ios" | "android";
  token: string;
  version_app?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const plataforma = input?.plataforma;
    const token = typeof input?.token === "string" ? input.token.trim() : "";
    if (plataforma !== "ios" && plataforma !== "android") {
      return { ok: false, error: "Plataforma no válida" };
    }
    if (!tokenValido(plataforma, token)) {
      return { ok: false, error: "Token de dispositivo no válido" };
    }
    const versionBruta =
      typeof input.version_app === "string" ? input.version_app.trim() : "";
    const version = VERSION_APP.test(versionBruta) ? versionBruta : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin.from("push_device_tokens").upsert(
      {
        user_id: session.user_id,
        company_id: session.company_id,
        platform: plataforma,
        token,
        app_version: version,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error) return { ok: false, error: error.message };

    // Solo se escribe la cookie si cambia: escribirla en cada arranque
    // obligaría a Next a repintar la página sin necesidad.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    if (jar.get(COOKIE_TOKEN_DISPOSITIVO)?.value !== token) {
      jar.set(COOKIE_TOKEN_DISPOSITIVO, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 400,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Da de baja el token de este dispositivo (el usuario desactiva los avisos).
 * Solo borra filas del propio usuario.
 */
export async function darDeBajaTokenDispositivoAction(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const limpio = typeof token === "string" ? token.trim() : "";
    if (!TOKEN_IOS.test(limpio) && !TOKEN_ANDROID.test(limpio)) {
      return { ok: false, error: "Token de dispositivo no válido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { error } = await admin
      .from("push_device_tokens")
      .delete()
      .eq("token", limpio)
      .eq("user_id", session.user_id);
    if (error) return { ok: false, error: error.message };

    const { cookies } = await import("next/headers");
    const jar = await cookies();
    if (jar.get(COOKIE_TOKEN_DISPOSITIVO)) jar.delete(COOKIE_TOKEN_DISPOSITIVO);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
