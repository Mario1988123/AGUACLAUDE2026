/**
 * Regla de idempotencia de puntos (auditoría 2026-10-01, I43), en puro para
 * poder probarla. Es la misma que aplica la RPC `award_points_once`.
 *
 * "Ya otorgado" = hay un asiento POSITIVO con ese motivo POSTERIOR a la última
 * reversión (asiento negativo) del mismo sujeto. Antes bastaba con que hubiera
 * cualquier asiento positivo, así que tras cancelar (reversión) y reactivar un
 * contrato los puntos no se podían volver a otorgar.
 */
export interface AsientoPuntos {
  points: number;
  reason: string;
  awarded_at: string;
}

export function yaOtorgado(asientos: AsientoPuntos[], motivo: string): boolean {
  let ultimaReversion = -Infinity;
  for (const a of asientos) {
    if (a.points < 0) {
      const t = new Date(a.awarded_at).getTime();
      if (t > ultimaReversion) ultimaReversion = t;
    }
  }
  return asientos.some(
    (a) =>
      a.points > 0 &&
      a.reason === motivo &&
      new Date(a.awarded_at).getTime() > ultimaReversion,
  );
}

/** Igual, para un conjunto de motivos (bundle de venta). */
export function yaOtorgadoAlguno(asientos: AsientoPuntos[], motivos: string[]): boolean {
  return motivos.some((m) => yaOtorgado(asientos, m));
}
