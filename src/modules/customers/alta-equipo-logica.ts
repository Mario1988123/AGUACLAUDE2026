/**
 * Lógica PURA del alta manual de un equipo («Añadir equipo» e importación).
 *
 * Decisión Mario 2026-11-09: la fecha de mantenimiento que se pone al dar de
 * alta un equipo antiguo o de otra empresa «es para llamarle en X fecha». No
 * se crean visitas contratadas: se crea UNA tarea de llamada en la agenda
 * para ofrecerle el mantenimiento. La periodicidad se aplica cuando el
 * cliente acepta «Proponer mantenimiento» (contrato de mantenimiento).
 */

/**
 * Origen del alta, EXPLÍCITO (no se deduce). «Añadir equipo» de la ficha
 * (suelto = alta_manual; con extras = pack, que también es alta manual)
 * convierte la fecha en UNA llamada. La importación mantiene sus visitas.
 *  - "pack": el equipo PRINCIPAL del pack (lleva la llamada de todo el pack).
 *  - "pack_extra": cada extra (nunca crea llamada propia).
 */
export type OrigenAltaEquipo = "alta_manual" | "pack" | "pack_extra" | "importacion";

/**
 * Qué se hace con la fecha / periodicidad de mantenimiento del alta:
 *  - "llamada": UNA tarea de llamada para ofrecer mantenimiento (alta manual
 *    suelta o principal de un pack, sin contrato de mantenimiento activo).
 *  - "nada": extra de un pack sin contrato (la llamada va en el principal).
 *  - "visitas": comportamiento de siempre (serie o visita única): importación
 *    o cliente con contrato de mantenimiento activo.
 */
export function programacionMantenimiento(
  origen: OrigenAltaEquipo,
  cubiertoPorContrato: boolean,
): "llamada" | "nada" | "visitas" {
  if (origen === "importacion" || cubiertoPorContrato) return "visitas";
  return origen === "pack_extra" ? "nada" : "llamada";
}

/** Hora de pared (Madrid) a la que se pone la llamada. [decide] 10:00. */
export const HORA_LLAMADA = "10:00";

/**
 * Día (YYYY-MM-DD) de la llamada a partir de lo que llega del formulario o
 * del Excel ("2026-12-01", "2026-12-01T09:00", ISO…). null si no hay fecha
 * válida.
 */
export function diaLlamada(valor: string | null | undefined): string | null {
  const s = (valor ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (
    d.getUTCFullYear() !== Number(m[1]) ||
    d.getUTCMonth() !== Number(m[2]) - 1 ||
    d.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function tituloLlamada(nombreEquipo: string, extras = 0): string {
  const sufijo = extras > 0 ? ` +${extras} ${extras === 1 ? "extra" : "extras"}` : "";
  return `Llamar para ofrecer mantenimiento · ${nombreEquipo}${sufijo}`;
}

export function descripcionLlamada(periodicidadMeses: number | null | undefined): string {
  const base =
    "Equipo dado de alta en el CRM (antiguo o de otra empresa). Llamar al cliente y ofrecerle el contrato de mantenimiento con «Proponer mantenimiento» en su ficha.";
  return periodicidadMeses && periodicidadMeses > 0
    ? `${base} Periodicidad indicada al dar de alta: cada ${periodicidadMeses} meses.`
    : base;
}
