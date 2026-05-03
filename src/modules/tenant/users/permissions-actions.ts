"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface ModuleOverride {
  module_key: string;
  granted: boolean;
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getUserModuleOverrides(userId: string): Promise<ModuleOverride[]> {
  const session = await ensureAdmin();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("user_module_overrides")
    .select("module_key, granted")
    .eq("user_id", userId)
    .eq("company_id", session.company_id);
  return (data ?? []) as ModuleOverride[];
}

export async function setUserModuleOverrideAction(
  userId: string,
  moduleKey: string,
  granted: boolean | null,
): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  if (granted === null) {
    // Quitar override → vuelve al default por rol
    await admin
      .from("user_module_overrides")
      .delete()
      .eq("user_id", userId)
      .eq("company_id", session.company_id)
      .eq("module_key", moduleKey);
  } else {
    await admin
      .from("user_module_overrides")
      .upsert(
        {
          user_id: userId,
          company_id: session.company_id,
          module_key: moduleKey,
          granted,
          set_by: session.user_id,
          set_at: new Date().toISOString(),
        },
        { onConflict: "user_id,company_id,module_key" },
      );
  }
  revalidatePath("/configuracion/usuarios");
}

/**
 * Devuelve los overrides activos del usuario actual. Lo usa el layout para
 * decidir qué módulos mostrar/ocultar en el sidebar.
 */
export async function getMyModuleOverrides(): Promise<Record<string, boolean>> {
  const session = await requireSession();
  if (!session.company_id) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("user_module_overrides")
    .select("module_key, granted")
    .eq("user_id", session.user_id)
    .eq("company_id", session.company_id);
  const map: Record<string, boolean> = {};
  for (const r of (data ?? []) as ModuleOverride[]) {
    map[r.module_key] = r.granted;
  }
  return map;
}
