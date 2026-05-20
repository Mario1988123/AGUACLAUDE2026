"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

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
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
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
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
