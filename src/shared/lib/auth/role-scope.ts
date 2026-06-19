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
 * ¿El usuario tiene una tarea ASIGNADA y ACTIVA para este cliente?
 *
 * Regla (2026-06-18): un técnico/instalador puede ver un cliente mientras tenga
 * una tarea asignada a él (agenda, instalación o mantenimiento) que NO esté
 * terminada ni cancelada. Cuando la completa, deja de verlo. Esto permite que el
 * scope normal (nivel 3 = solo lo suyo) se amplíe puntualmente al cliente de su
 * tarea, sin abrirle todo el CRM.
 *
 * Solo cuenta SUS asignaciones (assigned/installer/technician = session.user_id),
 * así que no expone clientes de otros. Defensivo: si una tabla/consulta falla,
 * se ignora (no concede acceso por ese camino).
 */
export async function hasActiveTaskForCustomer(
  session: SessionClaims,
  customerId: string,
): Promise<boolean> {
  if (!session.company_id || !customerId) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const NOT_DONE = "(completed,cancelled)";

  // Tarea de agenda vinculada directamente al cliente.
  try {
    const { count } = await admin
      .from("agenda_events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("assigned_user_id", session.user_id)
      .eq("subject_type", "customer")
      .eq("subject_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  // Instalación asignada al técnico para este cliente.
  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("installer_user_id", session.user_id)
      .eq("customer_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  // Mantenimiento asignado al técnico para este cliente.
  try {
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("technician_user_id", session.user_id)
      .eq("customer_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Días configurados por la empresa para que un comercial siga viendo a un
 * cliente tras venderle (company_settings.commercial_retention_days). 0 si no
 * está configurado o la columna aún no existe (defensivo).
 */
export async function getCommercialRetentionDays(companyId: string): Promise<number> {
  if (!companyId) return 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("company_settings")
      .select("commercial_retention_days")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return 0;
    return Number((data as { commercial_retention_days: number | null }).commercial_retention_days ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * IDs de clientes que un comercial (sales_rep, nivel 3) puede VER ADEMÁS de
 * los suyos asignados: aquellos a los que vendió (contrato firmado por él)
 * dentro de la ventana de retención configurada. Solo aplica a sales_rep puro;
 * para el resto de roles devuelve [] (no cambia su scope). La fecha de
 * referencia es contracts.signed_at (la venta). Defensivo ante fallos de BD.
 */
export async function getCommercialRetentionCustomerIds(
  session: SessionClaims,
): Promise<string[]> {
  if (!session.company_id) return [];
  if (session.is_superadmin || session.roles.includes("company_admin")) return [];
  if (isLevel2(session)) return [];
  if (!session.roles.includes("sales_rep")) return [];
  const days = await getCommercialRetentionDays(session.company_id);
  if (days <= 0) return [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("contracts")
      .select("customer_id")
      .eq("company_id", session.company_id)
      .eq("created_by", session.user_id)
      .not("signed_at", "is", null)
      .gte("signed_at", cutoff)
      .is("deleted_at", null)
      .limit(2000);
    return Array.from(
      new Set(
        ((data ?? []) as Array<{ customer_id: string | null }>)
          .map((r) => r.customer_id)
          .filter((x): x is string => Boolean(x)),
      ),
    );
  } catch {
    return [];
  }
}

/**
 * ¿El comercial vendió a este cliente dentro de la ventana de retención?
 * Usado por la ficha de cliente para mantener el acceso del comercial
 * durante esos días aunque el cliente ya no esté asignado a él.
 */
export async function hasRecentSaleForCustomer(
  session: SessionClaims,
  customerId: string,
): Promise<boolean> {
  if (!session.company_id || !customerId) return false;
  if (session.is_superadmin || session.roles.includes("company_admin")) return false;
  if (!session.roles.includes("sales_rep")) return false;
  const days = await getCommercialRetentionDays(session.company_id);
  if (days <= 0) return false;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("created_by", session.user_id)
      .eq("customer_id", customerId)
      .not("signed_at", "is", null)
      .gte("signed_at", cutoff)
      .is("deleted_at", null);
    return (count ?? 0) > 0;
  } catch {
    return false;
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
