/**
 * Helpers puros (sin "use server") relacionados con ciclos de comisiones.
 * Se separan de cycles-actions.ts para no violar la regla de Next.js
 * "Server Actions must be async functions".
 */
import { madridParts } from "@/shared/lib/format-date";
import {
  inicioDiaMadridUtc,
  rangoMesMadridUtc,
  sumarMesesClave,
} from "@/modules/scheduling/fechas-madrid";

/**
 * Resuelve el ciclo al que pertenece una fecha dada según `cycle_close_day`.
 *   close_day = 0  → ciclo natural [primer día del mes 00:00, primer día del mes siguiente 00:00)
 *                    cycle_year/month = año/mes natural
 *   close_day = D  → ciclo [día D del mes anterior 00:00, día D del mes actual 00:00)
 *                    cycle_year/month = año/mes en que CIERRA el ciclo
 *                    Ej. close_day=25, fecha 10/06/2026 → ciclo 06/2026 (rango 25/05 → 25/06)
 *                    Ej. close_day=25, fecha 28/06/2026 → ciclo 07/2026 (rango 25/06 → 25/07)
 */
export function computeCycleRange(
  date: Date,
  closeDay: number,
): { cycle_year: number; cycle_month: number; start_at: Date; end_at: Date } {
  // Todo en hora de Madrid (auditoría 2026-10-01, I36): el servidor está en
  // UTC y una venta del 1-oct a las 01:30 de Madrid caía en el ciclo de
  // septiembre. Los límites son las 00:00 de Madrid.
  const p = madridParts(date);
  const y = p.year;
  const m = p.month; // 1-12
  if (closeDay <= 0 || closeDay > 28) {
    const r = rangoMesMadridUtc(y, m);
    return {
      cycle_year: y,
      cycle_month: m,
      start_at: new Date(r.desde),
      end_at: new Date(r.hasta),
    };
  }
  // Mes (1-12) en que CIERRA el ciclo.
  let cierreAnio = y;
  let cierreMes = m;
  if (p.day >= closeDay) {
    cierreMes = m + 1;
    if (cierreMes > 12) {
      cierreMes = 1;
      cierreAnio = y + 1;
    }
  }
  const claveFin = `${cierreAnio}-${String(cierreMes).padStart(2, "0")}-${String(closeDay).padStart(2, "0")}`;
  const claveInicio = sumarMesesClave(claveFin, -1);
  return {
    cycle_year: cierreAnio,
    cycle_month: cierreMes,
    start_at: new Date(inicioDiaMadridUtc(claveInicio)),
    end_at: new Date(inicioDiaMadridUtc(claveFin)),
  };
}
