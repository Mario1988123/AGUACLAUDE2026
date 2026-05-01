import { createClient } from "@/shared/lib/supabase/server";
import { redirect } from "next/navigation";

export interface SessionClaims {
  user_id: string;
  email: string | null;
  is_superadmin: boolean;
  company_id: string | null;
  roles: string[];
  departments: string[];
  full_name: string | null;
}

const DEV_AUTOLOGIN =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true";

const DEV_FAKE_SESSION: SessionClaims = {
  user_id: "00000000-0000-0000-0000-000000000001",
  email: "dev@local",
  is_superadmin: true,
  company_id: null,
  roles: ["superadmin"],
  departments: [],
  full_name: "Dev Superadmin (LOCAL)",
};

/**
 * Lee el usuario actual y devuelve los claims tipados.
 * Si no hay sesión, redirige a /login.
 *
 * En desarrollo con NEXT_PUBLIC_LOCAL_AUTOLOGIN=true devuelve un superadmin
 * falso para entrar directo sin BD ni Auth Hook configurados.
 */
export async function requireSession(): Promise<SessionClaims> {
  if (DEV_AUTOLOGIN) return DEV_FAKE_SESSION;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const meta = user.app_metadata as Record<string, unknown>;

  return {
    user_id: user.id,
    email: user.email ?? null,
    is_superadmin: Boolean(meta.is_superadmin),
    company_id: (meta.company_id as string | null) ?? null,
    roles: (meta.roles as string[]) ?? [],
    departments: (meta.departments as string[]) ?? [],
    full_name: (meta.full_name as string | null) ?? null,
  };
}

/** Comprueba si la sesión actual tiene cualquiera de los roles indicados. */
export function hasAnyRole(session: SessionClaims, roles: string[]): boolean {
  if (session.is_superadmin) return true;
  return session.roles.some((r) => roles.includes(r));
}
