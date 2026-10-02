/**
 * Quién ve las comisiones de toda la plantilla (auditoría 2026-10-01, I16).
 * Admin de empresa, director comercial y superadmin; el resto solo las suyas.
 * Pura (sin I/O) para poder testearla y usarla en server actions y rutas.
 */
export function esGestorComisiones(session: {
  is_superadmin: boolean;
  roles: readonly string[];
}): boolean {
  return (
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director")
  );
}
