/**
 * Zona horaria por defecto del CRM. Forzada porque tanto el servidor
 * (Vercel funcs corren en UTC) como navegadores fuera de España no
 * deberían cambiar cómo se ve una hora pactada con el cliente.
 *
 * Si en el futuro hay clientes en Canarias se podría leer de
 * companies.timezone, pero por ahora todo se renderiza en Madrid.
 */
export const APP_TIMEZONE = "Europe/Madrid";

/**
 * Formateo de fechas en español (DD-MM-AAAA) usando zona Madrid.
 * Acepta:
 *  - string ISO (ej. "2026-05-22" o "2026-05-22T10:00:00Z")
 *  - Date
 *  - null/undefined → "—"
 */
export function formatDateES(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  // Intl.DateTimeFormat respeta timeZone tanto en server (Vercel UTC)
  // como en cliente — sin ese option, getDate()/getMonth() devolvían
  // valores en UTC durante SSR (bug 2026-06-02).
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

/**
 * Versión con hora si interesa (DD-MM-AAAA HH:mm), zona Madrid.
 */
export function formatDateTimeES(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

// ===========================================================================
// Hora "de pared" en Madrid para lógica de servidor.
//
// POR QUÉ: Vercel ejecuta las funciones en UTC, así que `new Date().getHours()`
// o `.getDay()` devuelven la hora/día en UTC, no en España (UTC+1 / +2 en
// verano). Eso descuadraba 1-2 h las decisiones de "fuera de horario",
// "mañana/tarde" y el rango "hoy". Estas funciones devuelven lo que vería un
// reloj colgado en Madrid para un instante dado.
// ===========================================================================

interface MadridParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** Día de la semana ISO: 0=Lunes ... 6=Domingo (como user_work_schedules). */
  isoDow: number;
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** Componentes de fecha/hora de un instante vistos en zona Madrid. */
export function madridParts(value: string | Date): MadridParts {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // algunos motores devuelven 24 a medianoche
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour,
    minute: parseInt(get("minute"), 10),
    isoDow: WEEKDAY_TO_ISO[get("weekday")] ?? 0,
  };
}

/** Hora de pared (0-23) en Madrid. */
export function madridHour(value: string | Date): number {
  return madridParts(value).hour;
}

/** Minutos desde medianoche (0-1439) en hora de pared Madrid. */
export function madridMinutesOfDay(value: string | Date): number {
  const p = madridParts(value);
  return p.hour * 60 + p.minute;
}

/** Día de la semana ISO en Madrid: 0=Lunes ... 6=Domingo. */
export function madridIsoDow(value: string | Date): number {
  return madridParts(value).isoDow;
}

/** Día de la semana estilo JS en Madrid: 0=Domingo ... 6=Sábado. */
export function madridJsDay(value: string | Date): number {
  // isoDow 0=Lun..6=Dom → js 0=Dom..6=Sáb
  return (madridParts(value).isoDow + 1) % 7;
}

/** Clave de día natural "YYYY-MM-DD" en Madrid. */
export function madridDateKey(value: string | Date): string {
  const p = madridParts(value);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Rango UTC [inicio, fin) que abarca el día natural de Madrid que contiene
 * `value`. Devuelve instantes (Date) listos para `.toISOString()` en filtros
 * `gte`/`lte` contra columnas timestamptz.
 *
 * Nota: en los 2 días de cambio de hora el día dura 23 h o 25 h; aquí
 * asumimos 24 h, suficiente para un rango "hoy" (el margen no afecta).
 */
export function madridDayRangeUtc(value: string | Date): { start: Date; end: Date } {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = madridParts(d);
  // Offset (ms) entre la hora de pared Madrid y UTC en este instante:
  // tratamos las componentes de pared como si fueran UTC y restamos.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const offsetMs = asUtc - d.getTime(); // +1h (invierno) o +2h (verano)
  const startWallAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const start = new Date(startWallAsUtc - offsetMs);
  const end = new Date(startWallAsUtc - offsetMs + 24 * 60 * 60 * 1000);
  return { start, end };
}
