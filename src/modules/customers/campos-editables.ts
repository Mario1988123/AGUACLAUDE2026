/**
 * Listas blancas de columnas editables desde los formularios de edición
 * (auditoría 2026-10-01, I13).
 *
 * updateCustomerAction / updateLeadAction escriben con el admin client, que se
 * salta la RLS. Antes copiaban el objeto recibido del navegador tal cual, así
 * que cualquier empleado podía mandar `assigned_user_id`, `status`,
 * `deleted_at` o `company_id` y el update los aplicaba. Ahora solo pasan las
 * columnas de esta lista; nunca id, company_id, created_by, assigned_user_id,
 * status, deleted_at ni similares.
 */

export const CAMPOS_EDITABLES_CLIENTE = [
  "legal_name",
  "trade_name",
  "first_name",
  "last_name",
  "email",
  "phone_primary",
  "phone_secondary",
  "tax_id",
  "notes",
  "is_autonomo",
] as const;

export const CAMPOS_EDITABLES_LEAD = [
  "party_kind",
  "legal_name",
  "trade_name",
  "first_name",
  "last_name",
  "email",
  "phone_primary",
  "phone_company",
  "tax_id",
  "notes",
  "potential",
] as const;

/**
 * Devuelve un objeto nuevo solo con las claves permitidas que vengan en
 * `entrada` (las ausentes no se añaden). Las claves heredadas del prototipo
 * se ignoran. Si `entrada` no es un objeto plano devuelve {}.
 */
export function elegirCampos<K extends string>(
  entrada: unknown,
  permitidos: readonly K[],
): Partial<Record<K, unknown>> {
  const salida: Partial<Record<K, unknown>> = {};
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return salida;
  const obj = entrada as Record<string, unknown>;
  for (const k of permitidos) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) salida[k] = obj[k];
  }
  return salida;
}
