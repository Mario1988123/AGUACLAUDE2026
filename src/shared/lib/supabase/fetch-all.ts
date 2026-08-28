/**
 * Paginación por rangos para saltarse el techo de filas de PostgREST.
 *
 * PostgREST tiene configurado `max-rows = 1000` en este proyecto (verificado
 * en el remoto). Ese techo es del SERVIDOR: un `.limit(2000)` o `.limit(5000)`
 * en el cliente NO lo levanta — la respuesta se corta a 1000 filas y NO viene
 * ningún error, así que el código de arriba cree que ya lo tiene todo. Es un
 * truncamiento silencioso: listados incompletos, informes que no cuadran y
 * campañas de mailing que se dejan destinatarios fuera.
 *
 * La forma correcta de leer más de 1000 filas es pedirlas por tramos con
 * `.range(desde, hasta)` hasta que un tramo venga incompleto.
 *
 * Uso:
 *   const rows = await fetchAllRows<Row>((from, to) =>
 *     supabase.from("customers").select("id, name")
 *       .eq("company_id", companyId)
 *       .order("created_at", { ascending: false })
 *       .range(from, to),
 *     { maxRows: 20000, label: "customers" },
 *   );
 *
 * IMPORTANTE: la query DEBE llevar un `.order()` estable. Sin orden
 * determinista, Postgres puede devolver la misma fila en dos tramos y omitir
 * otra.
 */

/** Techo de filas por respuesta que impone PostgREST en este proyecto. */
export const POSTGREST_MAX_ROWS = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts?: {
    /** Filas por tramo. Se recorta a 1000: pedir más no sirve de nada. */
    pageSize?: number;
    /** Tope de seguridad para no pasear la memoria si algo se desmadra. */
    maxRows?: number;
    /** Nombre para los logs cuando se corta o falla. */
    label?: string;
  },
): Promise<T[]> {
  const pageSize = Math.min(opts?.pageSize ?? POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS);
  const maxRows = opts?.maxRows ?? 50000;
  const label = opts?.label ?? "query";

  const out: T[] = [];
  let from = 0;

  // El bucle acaba por una de tres: tramo incompleto (fin natural), tope de
  // seguridad, o error. Nunca es infinito porque `from` siempre avanza.
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await buildPage(from, to);
    if (error) {
      // Devolvemos lo acumulado en vez de tumbar la página entera: mismo
      // criterio defensivo que el resto del código, pero DEJANDO RASTRO (el
      // fallo original era justamente que nadie se enteraba).
      console.error(`[fetchAllRows:${label}] tramo ${from}-${to} falló:`, error.message);
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break; // último tramo
    if (out.length >= maxRows) {
      console.warn(
        `[fetchAllRows:${label}] cortado en el tope de seguridad (${maxRows} filas). ` +
          "Hay más datos sin leer: esta consulta necesita un filtro real o paginación en la UI.",
      );
      break;
    }
    from += pageSize;
  }

  return out;
}
