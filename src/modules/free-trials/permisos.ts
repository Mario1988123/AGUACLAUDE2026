import type { SessionClaims } from "@/shared/lib/auth/session";

/**
 * Quién agenda la instalación de una prueba gratuita y le asigna instalador
 * (Mario 2026-11-26): el admin y el director técnico, igual que en
 * /instalaciones (programar y editar). El comercial NO asigna instalador:
 * crea la prueba y al admin le llega el aviso para agendarla.
 */
export function puedeAgendarPrueba(
  session: Pick<SessionClaims, "is_superadmin" | "roles">,
): boolean {
  return (
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director")
  );
}

/** Roles que reciben el aviso «prueba creada, agéndala». */
export const ROLES_QUE_AGENDAN_PRUEBA = ["company_admin", "technical_director"];
