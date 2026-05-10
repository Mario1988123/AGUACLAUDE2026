/**
 * Helpers puros (sin "use server") relacionados con ciclos de comisiones.
 * Se separan de cycles-actions.ts para no violar la regla de Next.js
 * "Server Actions must be async functions".
 */

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
  if (closeDay <= 0 || closeDay > 28) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const start = new Date(y, m, 1, 0, 0, 0);
    const end = new Date(y, m + 1, 1, 0, 0, 0);
    return {
      cycle_year: y,
      cycle_month: m + 1,
      start_at: start,
      end_at: end,
    };
  }
  const y = date.getFullYear();
  const m = date.getMonth();
  const day = date.getDate();
  let cycleYear: number;
  let cycleMonth: number;
  if (day >= closeDay) {
    cycleMonth = m + 1;
    cycleYear = y;
    if (cycleMonth > 11) {
      cycleMonth = 0;
      cycleYear = y + 1;
    }
  } else {
    cycleMonth = m;
    cycleYear = y;
  }
  const end = new Date(cycleYear, cycleMonth, closeDay, 0, 0, 0);
  const start = new Date(cycleYear, cycleMonth - 1, closeDay, 0, 0, 0);
  return {
    cycle_year: end.getFullYear(),
    cycle_month: end.getMonth() + 1,
    start_at: start,
    end_at: end,
  };
}
