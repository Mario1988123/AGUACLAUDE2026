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
 * Decodifica payload JWT sin verificar firma (Supabase ya la verificó al
 * emitirlo). Solo para leer custom claims.
 */
function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Lee el usuario actual y devuelve los claims tipados.
 * Custom claims (is_superadmin, company_id, roles, departments) los pone el
 * Custom Access Token Hook en el JWT, así que hay que decodificar el
 * access_token para leerlos (NO viven en user.app_metadata).
 */
export async function requireSession(): Promise<SessionClaims> {
  if (DEV_AUTOLOGIN) return DEV_FAKE_SESSION;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token as string | undefined;
  const claims = accessToken ? decodeJwt(accessToken) : {};
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;

  return {
    user_id: user.id,
    email: user.email ?? null,
    is_superadmin: Boolean(claims.is_superadmin ?? meta.is_superadmin),
    company_id:
      ((claims.company_id as string | undefined) ?? (meta.company_id as string | null)) ?? null,
    roles: (claims.roles as string[] | undefined) ?? (meta.roles as string[]) ?? [],
    departments:
      (claims.departments as string[] | undefined) ?? (meta.departments as string[]) ?? [],
    full_name:
      (claims.full_name as string | null | undefined) ??
      (meta.full_name as string | null) ??
      null,
  };
}

/** Comprueba si la sesión actual tiene cualquiera de los roles indicados. */
export function hasAnyRole(session: SessionClaims, roles: string[]): boolean {
  if (session.is_superadmin) return true;
  return session.roles.some((r) => roles.includes(r));
}
