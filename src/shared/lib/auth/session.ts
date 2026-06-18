import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { redirect } from "next/navigation";

export interface SessionClaims {
  user_id: string;
  email: string | null;
  is_superadmin: boolean;
  company_id: string | null;
  roles: string[];
  departments: string[];
  full_name: string | null;
  /** Si true, el usuario debe cambiar la contraseña ANTES de acceder a
   *  cualquier ruta privada. Lo usa enforcePasswordChange() en layouts. */
  must_change_password: boolean;
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
  must_change_password: false,
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

  const isSuperadmin = Boolean(claims.is_superadmin ?? meta.is_superadmin);
  const companyId =
    ((claims.company_id as string | undefined) ?? (meta.company_id as string | null)) ?? null;
  // Roles base: lo que traiga el JWT (lo pone el Custom Access Token Hook al
  // iniciar sesión). Más abajo los reconciliamos con la BD.
  let roles = (claims.roles as string[] | undefined) ?? (meta.roles as string[]) ?? [];
  const departments =
    (claims.departments as string[] | undefined) ?? (meta.departments as string[]) ?? [];

  // Lectura defensiva de must_change_password + status desde user_profiles. Si
  // la tabla no existe o falla, devolvemos valores neutros (no bloqueamos).
  let mustChangePassword = false;
  let profileStatus: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("user_profiles")
      .select("must_change_password, status")
      .eq("user_id", user.id)
      .maybeSingle();
    mustChangePassword = Boolean(
      (data as { must_change_password?: boolean } | null)?.must_change_password,
    );
    profileStatus = (data as { status?: string | null } | null)?.status ?? null;

    // ROBUSTEZ DE ROLES: los roles viven en el JWT, que se "graba" al iniciar
    // sesión. Si a un usuario lo nombran admin (o le cambian roles) DESPUÉS de
    // loguearse, su token viejo no lo refleja y quedaría bloqueado ("Solo
    // admin") hasta cerrar sesión y volver a entrar. Releemos los roles ACTIVOS
    // de user_roles (la fuente de verdad) y, si los hay, mandan ellos. Así un
    // admin nunca queda sin permisos por un token caducado, y un rol revocado
    // deja de funcionar al instante. Defensivo: si la lectura falla, nos
    // quedamos con los del token. (Superadmin no usa user_roles.)
    if (!isSuperadmin && companyId) {
      const { data: roleRows } = await admin
        .from("user_roles")
        .select("role_key")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
        .is("revoked_at", null);
      const dbRoles = ((roleRows ?? []) as Array<{ role_key: string | null }>)
        .map((r) => r.role_key)
        .filter((k): k is string => Boolean(k));
      if (dbRoles.length > 0) roles = dbRoles;
    }
  } catch {
    /* fail-soft */
  }

  // SEGURIDAD: si el usuario está suspendido o desactivado, NO debe acceder
  // aunque conserve sesión/JWT válido. Antes "Suspender" solo cambiaba el badge
  // y el ex-empleado seguía dentro hasta que el token caducaba. Superadmin y
  // 'invited' (onboarding) no se bloquean aquí.
  if (
    !isSuperadmin &&
    (profileStatus === "suspended" || profileStatus === "inactive")
  ) {
    redirect("/login?error=suspended");
  }

  return {
    user_id: user.id,
    email: user.email ?? null,
    is_superadmin: isSuperadmin,
    company_id: companyId,
    roles,
    departments,
    full_name:
      (claims.full_name as string | null | undefined) ??
      (meta.full_name as string | null) ??
      null,
    must_change_password: mustChangePassword,
  };
}

/**
 * Si el usuario debe cambiar la contraseña, redirige a /restablecer-password.
 * Llamar al inicio de los layouts privados ((tenant), (super)).
 */
export function enforcePasswordChange(session: SessionClaims): void {
  if (session.must_change_password) {
    redirect("/restablecer-password?required=1");
  }
}

/** Comprueba si la sesión actual tiene cualquiera de los roles indicados. */
export function hasAnyRole(session: SessionClaims, roles: string[]): boolean {
  if (session.is_superadmin) return true;
  return session.roles.some((r) => roles.includes(r));
}
