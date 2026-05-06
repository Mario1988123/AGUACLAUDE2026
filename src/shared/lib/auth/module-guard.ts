import { redirect } from "next/navigation";
import type { SessionClaims } from "./session";

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
