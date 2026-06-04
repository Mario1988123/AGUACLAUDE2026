/**
 * Permisos del módulo Productos (regla del usuario, ver
 * feedback_productos_permisos en memoria).
 *
 *   - Nivel 1 (company_admin) y superadmin: crean / editan / borran.
 *   - Nivel 2 y 3: solo lectura.
 *   - Director comercial: lectura + ve coste/margen (heredado de
 *     feedback_product_cost).
 *
 * Helpers booleanos a partir de SessionClaims para no repetir checks.
 */
import type { SessionClaims } from "@/shared/lib/auth/session";

/** True si el usuario puede crear/editar/borrar productos y configurar el módulo. */
export function isProductEditor(session: SessionClaims): boolean {
  if (session.is_superadmin) return true;
  return session.roles.includes("company_admin");
}

/** True si el usuario puede ver coste y margen del producto. */
export function canSeeProductCost(session: SessionClaims): boolean {
  if (session.is_superadmin) return true;
  return (
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director")
  );
}

/**
 * Error friendly cuando alguien sin permiso intenta una acción de escritura
 * en el módulo Productos. Devuelve el mensaje en español llano para el
 * usuario final, sin tecnicismos.
 */
export const PRODUCTS_NOT_EDITOR_ERROR =
  "Solo el administrador puede modificar productos.";
