"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Marca al usuario actual como ya-cambió-contraseña: pone
 * user_profiles.must_change_password = false. Se llama desde la
 * página /restablecer-password tras un updateUser exitoso para que el
 * próximo requireSession() ya no fuerce el redirect.
 */
export async function markPasswordChangedAction(): Promise<void> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Solo promover "invited" → "active". Antes esto ponía status='active'
  // SIEMPRE, así que un usuario suspended/inactive que cambiaba su contraseña
  // se reactivaba solo.
  const { data: prof } = await admin
    .from("user_profiles")
    .select("status")
    .eq("user_id", session.user_id)
    .maybeSingle();
  const curStatus = (prof as { status?: string | null } | null)?.status ?? null;

  const update: Record<string, unknown> = {
    must_change_password: false,
    activated_at: new Date().toISOString(),
  };
  if (curStatus === "invited") update.status = "active";

  const { error } = await admin
    .from("user_profiles")
    .update(update)
    .eq("user_id", session.user_id);
  if (error) {
    console.error("[markPasswordChanged] update failed:", error.message);
    throw new Error(`No se pudo marcar contraseña cambiada: ${error.message}`);
  }
  revalidatePath("/", "layout");
}
