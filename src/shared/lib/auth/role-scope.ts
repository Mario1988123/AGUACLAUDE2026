import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { SessionClaims } from "./session";

/**
 * Resuelve el conjunto de user_ids visibles para la sesión actual
 * según las reglas de scope (decisión usuario 2026-05-07):
 *
 *  · Nivel 1 (company_admin / superadmin): null → "todos los usuarios"
 *    (sin filtro). El caller usa null para no añadir cláusula.
 *
 *  · Nivel 2 (directores): self + miembros asignados via
 *    team_assignments (manager_user_id = self).
 *
 *  · Nivel 3 (sales_rep, telemarketer, installer): solo self.
 *
 * Devuelve `null` si es nivel 1 (no aplicar filtro), o `string[]` con
 * el listado de user_ids visibles. Si la lista está vacía el caller
 * debe devolver `[]` (no hay nada que ver).
 */
export async function resolveVisibleUserIds(
  session: SessionClaims,
): Promise<string[] | null> {
  if (session.is_superadmin || session.roles.includes("company_admin")) {
    return null; // sin filtro
  }
  const isLevel2 =
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  if (!isLevel2) {
    // Nivel 3: solo se ve a sí mismo
    return [session.user_id];
  }

  // Nivel 2: self + miembros asignados via team_assignments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("team_assignments")
      .select("member_user_id")
      .eq("company_id", session.company_id)
      .eq("manager_user_id", session.user_id)
      .is("revoked_at", null);
    type TA = { member_user_id: string };
    const ids = ((data ?? []) as TA[]).map((a) => a.member_user_id);
    return Array.from(new Set([session.user_id, ...ids]));
  } catch {
    // Fallback: solo se ve a sí mismo
    return [session.user_id];
  }
}

/**
 * Helpers de identificación de nivel (sin BD).
 */
export function isLevel1(session: SessionClaims): boolean {
  return session.is_superadmin || session.roles.includes("company_admin");
}
export function isLevel2(session: SessionClaims): boolean {
  return (
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director")
  );
}
