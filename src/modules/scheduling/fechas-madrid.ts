/**
 * Utilidades de fecha en hora de Madrid para crons y cálculos de periodo.
 *
 * POR QUÉ EXISTE (auditoría 2026-10-01, I33/I34/I35/I36): el servidor de
 * Vercel y la base de datos trabajan en UTC, y varios crons calculaban
 * "mañana", "este mes" o "dentro de N meses" con `setDate`/`setMonth` en UTC.
 * En España eso desplaza el día 1-2 horas y hace que un contrato firmado el
 * 1-oct a las 01:30 cuente para septiembre.
 *
 * Complementa a `@/shared/lib/format-date` (que es de otra zona) sin
 * modificarlo. A diferencia de `madridDayRangeUtc`, aquí los rangos de día son
 * EXACTOS también en los dos días de cambio de hora (23 h y 25 h).
 *
 * Convenciones:
 *  - "clave de día" = string "YYYY-MM-DD" del día natural de Madrid.
 *  - Los rangos son semiabiertos [desde, hasta): usar `gte(desde)` y
 *    `lt(hasta)` en las consultas.
 */
import { madridLocalToUtcISO, madridParts } from "@/shared/lib/format-date";

const RE_CLAVE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partirClave(clave: string): { y: number; m: number; d: number } {
  const m = RE_CLAVE.exec(clave);
  if (!m) throw new Error(`Clave de día no válida: ${clave}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function aClave(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Días del mes (mes 1-12). */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Clave "YYYY-MM-DD" del día natural de Madrid que contiene el instante. */
export function claveDiaMadrid(instante: Date | string): string {
  const p = madridParts(instante);
  return aClave(p.year, p.month, p.day);
}

/** Suma (o resta) días naturales a una clave de día. Sin efectos de zona. */
export function sumarDiasClave(clave: string, dias: number): string {
  const { y, m, d } = partirClave(clave);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return aClave(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Diferencia en días naturales (b − a) entre dos claves de día. */
export function diferenciaDiasClave(a: string, b: string): number {
  const pa = partirClave(a);
  const pb = partirClave(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000,
  );
}

/** Instante UTC (ISO) de las 00:00 de Madrid del día indicado. */
export function inicioDiaMadridUtc(clave: string): string {
  const iso = madridLocalToUtcISO(`${clave}T00:00:00`);
  if (!iso) throw new Error(`Clave de día no válida: ${clave}`);
  return iso;
}

/**
 * Rango UTC [desde, hasta) del día natural de Madrid. Exacto en los días de
 * cambio de hora (el día dura 23 h o 25 h).
 */
export function rangoDiaMadridUtc(clave: string): { desde: string; hasta: string } {
  return {
    desde: inicioDiaMadridUtc(clave),
    hasta: inicioDiaMadridUtc(sumarDiasClave(clave, 1)),
  };
}

/**
 * Margen para crons que corren alrededor de la medianoche de Madrid.
 * El cron diario corre a las 22:00 UTC, que son las 00:00 en verano y las
 * 23:00 en invierno. Sin margen, "mañana" cambiaba de día según la estación.
 */
export const MARGEN_MEDIANOCHE_MS = 2 * 60 * 60 * 1000;

/**
 * Día de referencia de una ejecución: el día de Madrid que empieza alrededor
 * de la ejecución. Con el cron a las 22:00 UTC es siempre el día que acaba de
 * empezar (verano) o que empieza dentro de una hora (invierno).
 */
export function diaReferenciaCron(ahora: Date = new Date()): string {
  return claveDiaMadrid(new Date(ahora.getTime() + MARGEN_MEDIANOCHE_MS));
}

/**
 * "Mañana" para avisos y órdenes de carga que se generan de noche: el día
 * siguiente al día de referencia. Quien lee el aviso por la mañana entiende
 * "mañana" como ese día, y la carga de la furgoneta tiene un día de margen.
 */
export function diaMananaCron(ahora: Date = new Date()): string {
  return sumarDiasClave(diaReferenciaCron(ahora), 1);
}

/** Año natural en Madrid. */
export function anioMadrid(instante: Date | string = new Date()): number {
  return madridParts(instante).year;
}

/** Mes natural en Madrid como {anio, mes (1-12)}. */
export function mesMadrid(instante: Date | string = new Date()): {
  anio: number;
  mes: number;
} {
  const p = madridParts(instante);
  return { anio: p.year, mes: p.month };
}

/** Rango UTC [desde, hasta) de un mes natural de Madrid (mes 1-12). */
export function rangoMesMadridUtc(
  anio: number,
  mes: number,
): { desde: string; hasta: string } {
  const sigAnio = mes === 12 ? anio + 1 : anio;
  const sigMes = mes === 12 ? 1 : mes + 1;
  return {
    desde: inicioDiaMadridUtc(aClave(anio, mes, 1)),
    hasta: inicioDiaMadridUtc(aClave(sigAnio, sigMes, 1)),
  };
}

/** Rango UTC [desde, hasta) del mes de Madrid que contiene el instante. */
export function rangoMesActualMadridUtc(
  instante: Date | string = new Date(),
): { desde: string; hasta: string } {
  const { anio, mes } = mesMadrid(instante);
  return rangoMesMadridUtc(anio, mes);
}

/**
 * Suma meses a una clave de día SIN desbordar: el 31-ene + 1 mes es el
 * 28/29-feb, no el 3-mar (que es lo que hace `Date.setMonth`).
 */
export function sumarMesesClave(clave: string, meses: number): string {
  const { y, m, d } = partirClave(clave);
  const total = y * 12 + (m - 1) + meses;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return aClave(ny, nm, Math.min(d, diasDelMes(ny, nm)));
}

/**
 * Suma meses a un instante conservando la hora de pared de Madrid y sin
 * desbordar el día. Una visita a las 10:00 de Madrid el 31-ene, +6 meses,
 * queda a las 10:00 de Madrid del 31-jul (aunque cambie el horario de verano).
 */
export function sumarMesesMadrid(instante: Date | string, meses: number): Date {
  const p = madridParts(instante);
  const clave = sumarMesesClave(aClave(p.year, p.month, p.day), meses);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  const iso = madridLocalToUtcISO(`${clave}T${hh}:${mm}:00`);
  if (!iso) throw new Error("Fecha no válida");
  return new Date(iso);
}
