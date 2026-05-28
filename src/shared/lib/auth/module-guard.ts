import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { SessionClaims } from "./session";

/**
 * Comprueba si un módulo está activo para la empresa actual. Lee
 * `company_modules.is_active` filtrado por `module_key`. Si la tabla
 * no existe o falla la query, devuelve `true` (fail-open) — es mejor
 * mostrar el módulo que ocultarlo por error de infraestructura.
 *
 * Usar para gating de páginas/widgets cuando el cliente puede haber
 * desactivado el módulo desde /configuracion/modulos.
 */
export async function isModuleActive(moduleKey: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data, error } = await supabase
      .from("company_modules")
      .select("is_active")
      .eq("module_key", moduleKey)
      .maybeSingle();
    if (error) return true; // fail-open
    if (!data) return true; // sin registro = activo por defecto
    return Boolean((data as { is_active: boolean }).is_active);
  } catch {
    return true;
  }
}

/**
 * Devuelve el conjunto de módulos activos. Más eficiente que llamar a
 * `isModuleActive` repetidas veces. Si la tabla falla, devuelve null
 * (fail-open: el caller debe asumir todo activo).
 */
export async function listActiveModules(): Promise<Set<string> | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data, error } = await supabase
      .from("company_modules")
      .select("module_key, is_active")
      .eq("is_active", true);
    if (error) return null;
    return new Set(
      ((data ?? []) as Array<{ module_key: string }>).map((m) => m.module_key),
    );
  } catch {
    return null;
  }
}

/**
 * Aserción para páginas: si el módulo no está activo en la empresa,
 * redirige a /dashboard. Llamar al inicio del componente server.
 *
 * Ejemplo:
 *   export default async function FichajesPage() {
 *     await assertModuleActive("time_tracking");
 *     ...
 *   }
 */
export async function assertModuleActive(moduleKey: string): Promise<void> {
  const active = await isModuleActive(moduleKey);
  if (!active) redirect("/dashboard");
}

/**
 * Versión server-to-server (sin sesión) para crons y flujos cross-module que
 * operan con admin client. Devuelve `false` SOLO si existe una fila explícita
 * con `is_active=false` para esa empresa+módulo. Si no hay fila o falla la
 * query → `true` (FAIL-OPEN: no romper flujos de empresas sin configuración
 * explícita, coherente con `isModuleActive`).
 */
export async function isModuleActiveForCompany(
  companyId: string,
  moduleKey: string,
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("company_modules")
      .select("is_active")
      .eq("company_id", companyId)
      .eq("module_key", moduleKey)
      .maybeSingle();
    if (error) return true;
    if (!data) return true;
    return Boolean((data as { is_active: boolean }).is_active);
  } catch {
    return true;
  }
}

/**
 * Para bucles de cron que iteran muchas empresas: devuelve el conjunto de
 * `company_id` que han DESACTIVADO explícitamente el módulo (fila is_active=
 * false). El caller hace `if (disabled.has(companyId)) continue;`. Empresas
 * sin fila NO se incluyen → se las trata como activas (fail-open).
 */
export async function companiesWithModuleDisabled(
  moduleKey: string,
): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("company_modules")
      .select("company_id")
      .eq("module_key", moduleKey)
      .eq("is_active", false);
    if (error) return new Set();
    return new Set(
      ((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id),
    );
  } catch {
    return new Set();
  }
}

/**
 * Comprueba si la sesión actual tiene acceso al módulo dado, en base
 * a la lista de roles permitidos. Si no, redirige al dashboard. Niveles
 * 1 (company_admin) y superadmin siempre pasan.
 *
 * Usar en server components de páginas privadas que deben respetar el
 * scope de rol más allá del filtrado en BD (por seguridad doble).
 *
 * Ejemplo:
 *   const session = await requireSession();
 *   requireModuleAccess(session, ["company_admin", "technical_director", "installer"]);
 */
export function requireModuleAccess(
  session: SessionClaims,
  allowedRoles: string[],
): void {
  if (session.is_superadmin || session.roles.includes("company_admin")) return;
  const ok = session.roles.some((r) => allowedRoles.includes(r));
  if (!ok) redirect("/dashboard");
}
