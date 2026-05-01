import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "@/shared/lib/env";
import type { Database } from "@/shared/types/database.types";

const DEV_AUTOLOGIN =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true";

export async function createClient() {
  // En dev autologin no hay user real en Supabase Auth: usamos service_role
  // para bypass RLS y poder navegar como "superadmin local".
  if (DEV_AUTOLOGIN) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      return createPlainClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // ignore - called from RSC
          }
        },
      },
    },
  );
}
