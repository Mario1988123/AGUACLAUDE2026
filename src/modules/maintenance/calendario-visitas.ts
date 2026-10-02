/**
 * Cálculo puro de las visitas teóricas de mantenimiento (sin BD) para poder
 * probarlo. Auditoría 2026-10-01, I35:
 *  - `Date.setMonth` desbordaba: un servicio que empieza el 31-ene con
 *    periodicidad mensual caía el 3-mar. Ahora se suma sin desbordar y
 *    conservando la hora de pared de Madrid.
 *  - Una visita que el cliente mueve (del 10 al 20) se recreaba el día 10
 *    porque solo se comparaba con `scheduled_at`. Ahora también se compara con
 *    `original_scheduled_at`, que se conserva al mover la visita.
 */
import { sumarMesesMadrid } from "@/modules/scheduling/fechas-madrid";

export interface VisitaExistente {
  scheduled_at: string | null;
  original_scheduled_at?: string | null;
}

/**
 * Fechas teóricas base + n·periodicidad (n = 1..totalVisitas) que caen en
 * la ventana [desde, hasta].
 */
export function fechasTeoricasContrato(input: {
  base: Date;
  periodicidadMeses: number;
  totalVisitas: number;
  desde: Date;
  hasta: Date;
}): Array<{ idx: number; fecha: Date }> {
  const out: Array<{ idx: number; fecha: Date }> = [];
  if (input.periodicidadMeses <= 0 || isNaN(input.base.getTime())) return out;
  for (let n = 1; n <= input.totalVisitas; n++) {
    const d = sumarMesesMadrid(input.base, n * input.periodicidadMeses);
    if (d.getTime() >= input.desde.getTime() && d.getTime() <= input.hasta.getTime()) {
      out.push({ idx: n, fecha: d });
    }
  }
  return out;
}

/**
 * Serie de un equipo: desde `primera` (adelantada al futuro si ya pasó) cada
 * `periodicidadMeses`, mientras quepa en [ahora, hasta]. Se calcula siempre
 * desde `primera` (k·periodicidad), no encadenando sumas, para que un día 31
 * no vaya bajando a 30 y 28 en cada salto.
 */
export function serieEquipo(input: {
  primera: Date;
  periodicidadMeses: number;
  ahora: Date;
  hasta: Date;
}): Date[] {
  const out: Date[] = [];
  if (input.periodicidadMeses <= 0 || isNaN(input.primera.getTime())) return out;
  let k = 0;
  let d = new Date(input.primera);
  while (d.getTime() < input.ahora.getTime() && k < 240) {
    k++;
    d = sumarMesesMadrid(input.primera, k * input.periodicidadMeses);
  }
  let guard = 0;
  while (d.getTime() <= input.hasta.getTime() && guard < 60) {
    out.push(d);
    k++;
    guard++;
    d = sumarMesesMadrid(input.primera, k * input.periodicidadMeses);
  }
  return out;
}

/**
 * ¿Ya existe una visita para esa fecha teórica? Compara con la fecha
 * original (si la visita se movió) y con la actual, con tolerancia.
 */
export function yaExisteVisita(
  fecha: Date,
  existentes: VisitaExistente[],
  toleranciaMs: number,
): boolean {
  const t = fecha.getTime();
  return existentes.some((e) => {
    for (const v of [e.original_scheduled_at, e.scheduled_at]) {
      if (!v) continue;
      const ms = new Date(v).getTime();
      if (!isNaN(ms) && Math.abs(ms - t) < toleranciaMs) return true;
    }
    return false;
  });
}
