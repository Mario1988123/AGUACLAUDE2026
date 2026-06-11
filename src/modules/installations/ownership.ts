import "server-only";
import { createAdminClient } from "@/shared/lib/supabase/admin";

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
 * Igual que `loadOwnedInstallation` pero solo verifica (no devuelve datos).
 * Útil antes de un UPDATE puntual.
 */
export async function assertInstallationCompany(
  installationId: string,
  companyId: string,
): Promise<void> {
  await loadOwnedInstallation(installationId, companyId, "id");
}
