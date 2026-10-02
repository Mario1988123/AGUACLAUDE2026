/**
 * Fechas de la remesa SEPA (lógica pura, sin BD).
 *
 * `ReqdColltnDt` debe ser un día hábil TARGET2 (el calendario de los adeudos
 * SEPA: cierra sábados, domingos, 1 de enero, Viernes Santo, Lunes de
 * Pascua, 1 de mayo, 25 y 26 de diciembre) y posterior a hoy. Antes se ponía
 * "hoy en UTC", que el banco rechaza y que entre las 00:00 y las 02:00 de
 * Madrid era además el día ANTERIOR.
 *
 * [decide] Plazo por defecto: 2 días hábiles (pregunta de negocio 10, sin
 * respuesta). Si el banco acepta D+1, una fecha posterior sigue siendo
 * válida; una anterior se rechaza.
 */

export const DIAS_HABILES_REMESA = 2;

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher), en UTC. */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function claveDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ¿Es día hábil TARGET2? `d` es una fecha a medianoche UTC (día civil). */
export function esDiaHabilTarget2(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const mmdd = claveDia(d).slice(5);
  if (["01-01", "05-01", "12-25", "12-26"].includes(mmdd)) return false;
  const pascua = domingoDePascua(d.getUTCFullYear());
  const viernesSanto = new Date(pascua.getTime() - 2 * 86400000);
  const lunesPascua = new Date(pascua.getTime() + 86400000);
  const k = claveDia(d);
  if (k === claveDia(viernesSanto) || k === claveDia(lunesPascua)) return false;
  return true;
}

/**
 * Fecha de cobro: `diasHabiles` días hábiles TARGET2 después de `hoyMadrid`
 * ("YYYY-MM-DD", el día civil de Madrid). Devuelve "YYYY-MM-DD".
 */
export function fechaCobroSepa(hoyMadrid: string, diasHabiles = DIAS_HABILES_REMESA): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoyMadrid)) throw new Error(`Fecha no válida: ${hoyMadrid}`);
  if (!Number.isInteger(diasHabiles) || diasHabiles < 1) throw new Error("Plazo SEPA no válido");
  const [y, m, d] = hoyMadrid.split("-").map(Number) as [number, number, number];
  let cur = new Date(Date.UTC(y, m - 1, d));
  let restantes = diasHabiles;
  while (restantes > 0) {
    cur = new Date(cur.getTime() + 86400000);
    if (esDiaHabilTarget2(cur)) restantes--;
  }
  return claveDia(cur);
}
