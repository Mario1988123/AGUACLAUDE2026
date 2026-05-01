import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/shared/lib/env";
import type { Database } from "@/shared/types/database.types";

/**
 * Cliente service_role. SOLO para uso server-side con privilegios elevados:
 * crear empresas, resetear contraseñas, gestionar usuarios. NUNCA exponer al cliente.
 * Bypass RLS — usar solo cuando el caller ya esté validado como superadmin.
 */
export function createAdminClient() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurado");
  }
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
