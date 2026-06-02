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
