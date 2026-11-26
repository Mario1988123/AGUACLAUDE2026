/**
 * Valor de una característica (product_attribute_values) como texto, leyendo
 * la columna que TENGA dato, sin fiarse de `data_type`.
 *
 * Por qué (2026-11-27): `data_type` vive en `product_attributes`, no en
 * `product_attribute_values`. Seis consultas lo pedían a la tabla de valores,
 * PostgREST devolvía error y la tabla de características salía vacía en todos
 * los PDF y en la ficha pública. Además hay atributos de tipo número con el
 * valor en texto («220-240V~50/60Hz»): mirando solo la columna del tipo se
 * perdían.
 *
 * Módulo puro (sin base de datos): lo usan los generadores de PDF y la ficha
 * pública.
 */

export interface ValorAtributoCrudo {
  value_text: string | null;
  value_number: number | string | null;
  value_boolean: boolean | null;
  unit?: string | null;
}

function aNumero(v: number | string | null): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ¿Tiene dato en alguna de las tres columnas? */
export function tieneValorAtributo(v: ValorAtributoCrudo): boolean {
  if (v.value_boolean != null) return true;
  if (aNumero(v.value_number) != null) return true;
  return !!v.value_text && v.value_text.trim().length > 0;
}

/** Número con formato español («0,27», «1.000»). */
export function formatearNumeroEs(n: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(n);
}

/**
 * Texto del valor (con su unidad si es número o texto que no la lleva ya).
 * Null si no hay dato. Orden: booleano → número → texto.
 */
export function textoValorAtributo(v: ValorAtributoCrudo): string | null {
  if (v.value_boolean != null) return v.value_boolean ? "Sí" : "No";
  const unidad = v.unit?.trim() || null;
  const n = aNumero(v.value_number);
  if (n != null) return `${formatearNumeroEs(n)}${unidad ? " " + unidad : ""}`;
  const t = v.value_text?.trim();
  if (!t) return null;
  if (unidad && !t.toLowerCase().endsWith(unidad.toLowerCase())) return `${t} ${unidad}`;
  return t;
}
