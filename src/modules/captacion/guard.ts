import "server-only";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";

/**
 * Guard ESTRICTO del módulo de captación por WhatsApp.
 *
 * El guard general (`isModuleActive`) es «abierto si falla»: sin fila en
 * company_modules da el módulo por activo. Este módulo manda mensajes que
 * cuestan dinero y tienen riesgo legal, así que aquí es al revés: hace falta
 * una fila explícita con is_active = true, y si la consulta falla, la
 * respuesta es «no».
 */
export const CAPTACION_MODULE_KEY = "captacion";

/** Roles que leen la configuración y la conexión (admin y directores). */
export const ROLES_CONFIG_LECTURA = [
  "company_admin",
  "commercial_director",
  "telemarketing_director",
] as const;

export async function captacionActiva(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("company_modules")
      .select("is_active")
      .eq("company_id", companyId)
      .eq("module_key", CAPTACION_MODULE_KEY)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { is_active: boolean }).is_active === true;
  } catch {
    return false;
  }
}

/**
 * ¿Puede salir un mensaje en frío de esta empresa? Tres llaves: módulo activo,
 * conexión activa con `envios_activos` y CAPTACION_ENVIOS_ACTIVOS=1 en el
 * entorno. Lo usará el cron de envíos (fase 3); ya queda aquí para que nadie
 * escriba otra versión más floja.
 */
export async function enviosEnFrioPermitidos(companyId: string): Promise<boolean> {
  if (process.env.CAPTACION_ENVIOS_ACTIVOS !== "1") return false;
  if (!(await captacionActiva(companyId))) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("captacion_conexiones")
      .select("estado, envios_activos")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return false;
    const c = data as { estado: string; envios_activos: boolean };
    return c.estado === "activa" && c.envios_activos === true;
  } catch {
    return false;
  }
}

export function puedeLeerConfig(session: SessionClaims): boolean {
  if (session.is_superadmin) return true;
  return session.roles.some((r) => (ROLES_CONFIG_LECTURA as readonly string[]).includes(r));
}

export function esAdminCaptacion(session: SessionClaims): boolean {
  return session.is_superadmin || session.roles.includes("company_admin");
}

/**
 * Roles que ven la lista de bloqueo y leen la FAQ del asistente (fase 8, para
 * la navegación de /captacion). Es la misma lista que usan
 * bloqueos-actions.ts (ROLES_BLOQUEOS) y asistente-actions.ts (LECTORES),
 * que son las que de verdad cortan el acceso.
 */
export const ROLES_EQUIPO_CAPTACION = [...ROLES_CONFIG_LECTURA, "sales_rep", "telemarketer"] as const;

export function esEquipoCaptacion(session: SessionClaims): boolean {
  if (session.is_superadmin) return true;
  return session.roles.some((r) => (ROLES_EQUIPO_CAPTACION as readonly string[]).includes(r));
}

/**
 * Para páginas: exige sesión con empresa y el módulo activo de forma
 * explícita. Si no, al dashboard.
 */
export async function assertCaptacionActiva(): Promise<SessionClaims & { company_id: string }> {
  const session = await requireSession();
  if (!session.company_id) redirect("/dashboard");
  if (!(await captacionActiva(session.company_id))) redirect("/dashboard");
  return session as SessionClaims & { company_id: string };
}
