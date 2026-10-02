/**
 * Cálculo puro del churn_score (0-100) por cliente, a partir de agregados
 * leídos de una vez (auditoría 2026-10-01, C2). Antes el cron diario hacía
 * ~5 consultas por cliente, en serie, y moría a los 300 s.
 *
 * Heurística (la misma que había en el cron diario, decisión 2026-05-20):
 *   · Último mantenimiento completado hace > 365 días → +30
 *   · Último mantenimiento completado hace 181-365 días → +15
 *   · Algún cobro rechazado en los últimos 180 días     → +25
 *   · Alguna incidencia abierta                          → +15
 *   · Algún contrato cancelado                           → +15
 * Resultado acotado a 0-100.
 */

export interface AgregadosChurn {
  /** customer_id → instante (ms) del último mantenimiento completado. */
  ultimoMantenimiento: Map<string, number>;
  conCobroRechazado: Set<string>;
  conIncidenciaAbierta: Set<string>;
  conContratoCancelado: Set<string>;
}

const DIA_MS = 86400000;

export function puntuacionChurn(
  customerId: string,
  ag: AgregadosChurn,
  ahoraMs: number,
): number {
  let score = 0;
  const ultimo = ag.ultimoMantenimiento.get(customerId);
  if (ultimo !== undefined) {
    const dias = Math.floor((ahoraMs - ultimo) / DIA_MS);
    if (dias > 365) score += 30;
    else if (dias > 180) score += 15;
  }
  if (ag.conCobroRechazado.has(customerId)) score += 25;
  if (ag.conIncidenciaAbierta.has(customerId)) score += 15;
  if (ag.conContratoCancelado.has(customerId)) score += 15;
  return Math.max(0, Math.min(100, score));
}

/**
 * Agrupa los clientes cuya puntuación CAMBIA por la nueva puntuación, para
 * actualizarlos con pocas consultas (una por valor y tramo de ids).
 */
export function agruparCambios(
  clientes: Array<{ id: string; churn_score: number | null }>,
  ag: AgregadosChurn,
  ahoraMs: number,
): Map<number, string[]> {
  const grupos = new Map<number, string[]>();
  for (const c of clientes) {
    const nuevo = puntuacionChurn(c.id, ag, ahoraMs);
    if (c.churn_score === nuevo) continue;
    const lista = grupos.get(nuevo) ?? [];
    lista.push(c.id);
    grupos.set(nuevo, lista);
  }
  return grupos;
}

/** Trocea una lista en tramos de tamaño fijo. */
export function enTramos<T>(lista: T[], tam: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam));
  return out;
}
