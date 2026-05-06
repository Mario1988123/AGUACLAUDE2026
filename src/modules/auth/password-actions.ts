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
  const { error } = await admin
    .from("user_profiles")
    .update({
      must_change_password: false,
      activated_at: new Date().toISOString(),
    })
    .eq("user_id", session.user_id);
  if (error) {
    console.error("[markPasswordChanged] update failed:", error.message);
    throw new Error(`No se pudo marcar contraseña cambiada: ${error.message}`);
  }
  revalidatePath("/", "layout");
}
