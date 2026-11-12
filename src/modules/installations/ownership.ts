import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import type { SessionClaims } from "@/shared/lib/auth/session";
import { assertTrabajoAsignado } from "@/shared/lib/auth/role-scope";

/**
 * Comprueba que una instalación pertenece a la empresa indicada y la
 * devuelve (solo las columnas pedidas). Lanza si no existe o es de otra
 * empresa.
 *
 * POR QUÉ EXISTE: las server actions de instalación usan el admin client
 * (`createAdminClient`), que SE SALTA la seguridad por filas (RLS). Si la
 * acción filtra solo por el `id` que manda el navegador, un usuario de la
 * empresa A podría tocar instalaciones de la empresa B pasando su UUID.
 * Pasar SIEMPRE por aquí (o añadir `.eq("company_id", …)` a la consulta)
 * antes de leer/escribir una instalación con admin client.
 *
 * Patrón equivalente: `assertInstallationOwnership` en photo-actions.ts.
 */
export async function loadOwnedInstallation<T = { id: string }>(
  installationId: string,
  companyId: string,
  select = "id",
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("installations")
    .select(select)
    .eq("id", installationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) {
    throw new Error("Instalación no encontrada o no pertenece a tu empresa");
  }
  return data as T;
}

/**
 * Empresa + asignación (2026-11-12): nivel 1/2 opera cualquier instalación de
 * su empresa; el resto, solo las que tiene asignadas (installer_user_id).
 * Usar en las acciones de campo: firma, fotos, inicio, pausa, cierre.
 */
export async function assertInstallationAssignee(
  installationId: string,
  session: SessionClaims,
): Promise<void> {
  if (!session.company_id) throw new Error("Sin empresa");
  const inst = await loadOwnedInstallation<{ installer_user_id: string | null }>(
    installationId,
    session.company_id,
    "id, installer_user_id",
  );
  assertTrabajoAsignado(session, inst.installer_user_id, "instalación");
}

/**
 * Igual que `loadOwnedInstallation` pero solo verifica (no devuelve datos).
 * Útil antes de un UPDATE puntual.
 */
export async function assertInstallationCompany(
  installationId: string,
  companyId: string,
): Promise<void> {
  await loadOwnedInstallation(installationId, companyId, "id");
}
