/**
 * Tipos y defaults del SLA. Sin "use server" para que se puedan exportar
 * objetos/constantes — Next.js exige que un fichero "use server" solo exporte
 * funciones async.
 */
export interface SlaSettings {
  /** Horas máximas para resolver según prioridad. */
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export const SLA_DEFAULTS: SlaSettings = {
  low: 72,
  medium: 24,
  high: 8,
  critical: 2,
};
