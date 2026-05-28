/**
 * Formateo de importes monetarios en español.
 *
 * Centraliza las ~20 copias locales de `new Intl.NumberFormat("es-ES",
 * { style:"currency", currency:"EUR" }).format(cents/100)` que había
 * repartidas por las vistas (wallet, contratos, facturas, comisiones…).
 *
 * Entrada en CÉNTIMOS (enteros). `null`/`undefined` → "—" (placeholder neutro,
 * que es lo que hacía la mayoría de copias; las que tipaban `number` nunca
 * reciben null, así que su salida no cambia).
 *
 * OJO: NO usar para CSV/export — allí se usa coma decimal SIN símbolo € (ver
 * `toCsv`/rutas de export). Tampoco para casos que necesiten devolver null en 0.
 */
export function formatEur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** Alias histórico: muchas vistas llamaban a esto `formatCents`. */
export const formatCents = formatEur;
