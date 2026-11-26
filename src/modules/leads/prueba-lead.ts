/**
 * Estado de la prueba gratuita que se pinta en el lead (lista y ficha).
 *
 * «Prueba activa» = el equipo está INSTALADO en casa del cliente (Mario
 * 2026-11-26). Una prueba en borrador o agendada todavía no está activa:
 * sale como «Instalación pendiente de prueba gratuita».
 *
 * Sin "use server" ni dependencias: lo usan el servidor y los tests.
 */
export function pruebaEstaActiva(status: string): boolean {
  // «expired» = terminó sin decidir, pero el equipo sigue en casa del
  // cliente: cuenta como activa (plazo cumplido) hasta que se decida.
  return status === "installed" || status === "expired";
}

export const TEXTO_PRUEBA_PENDIENTE = "Instalación pendiente de prueba gratuita";

const DIA_MS = 86_400_000;

/** Fecha de calendario de Madrid ("AAAA-MM-DD") de un instante. */
export function fechaMadrid(valor: string | Date): string {
  const d = typeof valor === "string" ? new Date(valor) : valor;
  // en-CA da el formato AAAA-MM-DD.
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

function diaUtc(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * Días que le quedan a una prueba instalada: fin = día de instalación +
 * duración (en días de calendario de Madrid). Nunca negativo.
 * null si falta la fecha de instalación.
 */
export function diasRestantesPrueba(
  installedAt: string | null | undefined,
  durationDays: number | null | undefined,
  ahora: Date = new Date(),
): number | null {
  if (!installedAt) return null;
  const duracion = Number.isFinite(durationDays) ? Number(durationDays) : 0;
  const fin = diaUtc(fechaMadrid(installedAt)) + duracion * DIA_MS;
  const hoy = diaUtc(fechaMadrid(ahora));
  return Math.max(0, Math.round((fin - hoy) / DIA_MS));
}

/** «Prueba activa · quedan N días» (o «último día» / «plazo cumplido»). */
export function textoPruebaActiva(diasRestantes: number | null): string {
  if (diasRestantes === null) return "Prueba activa";
  if (diasRestantes <= 0) return "Prueba activa · plazo cumplido";
  if (diasRestantes === 1) return "Prueba activa · queda 1 día";
  return `Prueba activa · quedan ${diasRestantes} días`;
}
