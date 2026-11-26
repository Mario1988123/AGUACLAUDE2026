/**
 * Estado de la prueba gratuita que se pinta en el listado de leads.
 *
 * «Prueba activa» = el equipo está INSTALADO en casa del cliente (Mario
 * 2026-11-26). Una prueba en borrador o agendada todavía no está activa:
 * sale como «Prueba por instalar».
 */
export function pruebaEstaActiva(status: string): boolean {
  return status === "installed";
}
