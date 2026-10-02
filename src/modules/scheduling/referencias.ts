/**
 * Numeración de códigos de referencia "PREFIJO-AAAA-NNNN" (auditoría
 * 2026-10-01, I25).
 *
 * Usa la RPC `public.next_reference_code` (migración
 * 20261002090200_numeracion_contadores_referencia.sql), que entrega números
 * sin colisiones aunque dos usuarios creen a la vez, ordena por número (no por
 * texto) y calcula el año en hora de Madrid.
 *
 * Mientras la migración no esté aplicada, cae al cálculo antiguo (máximo + 1)
 * pero ya con orden numérico y año de Madrid. Se puede quitar el respaldo
 * cuando la migración esté en producción.
 *
 * IMPORTANTE: la RPC solo la puede ejecutar service_role → pasar SIEMPRE el
 * admin client y el company_id de la sesión (nunca uno que venga del
 * navegador).
 */
import { anioMadrid } from "./fechas-madrid";

export type TablaConReferencia =
  | "proposals"
  | "contracts"
  | "installations"
  | "maintenance_contracts"
  | "maintenance_jobs"
  | "savings_proposals"
  | "free_trials"
  | "incidents";

/** Número final de un código "X-2026-0042" → 42 (null si no tiene). */
export function numeroDeReferencia(codigo: string | null | undefined): number | null {
  if (!codigo) return null;
  const m = /(\d+)$/.exec(codigo);
  return m ? Number(m[1]) : null;
}

/** Construye "PREFIJO-AAAA-NNNN" (4 cifras como mínimo; más si hace falta). */
export function formatearReferencia(prefijo: string, anio: number, numero: number): string {
  return `${prefijo}-${anio}-${String(numero).padStart(4, "0")}`;
}

/** Siguiente número a partir de códigos existentes, por valor numérico. */
export function siguienteNumero(codigos: Array<string | null | undefined>): number {
  let max = 0;
  for (const c of codigos) {
    const n = numeroDeReferencia(c);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

function esFuncionInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}

export async function siguienteReferencia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  tabla: TablaConReferencia,
  prefijo: string,
): Promise<string> {
  const { data, error } = await admin.rpc("next_reference_code", {
    p_company_id: companyId,
    p_table: tabla,
    p_prefix: prefijo,
  });
  if (!error && typeof data === "string" && data) return data;
  if (error && !esFuncionInexistente(error)) {
    throw new Error(`No se pudo numerar (${tabla}): ${error.message}`);
  }

  // Respaldo sin migración: máximo numérico + 1 (sigue sin bloqueo, pero ya
  // no repite al pasar de 9999 ni usa el año UTC).
  const anio = anioMadrid();
  const base = `${prefijo}-${anio}-`;
  const { data: filas, error: errSel } = await admin
    .from(tabla)
    .select("reference_code")
    .eq("company_id", companyId)
    .like("reference_code", `${base}%`)
    .limit(10000);
  if (errSel) throw new Error(`No se pudo numerar (${tabla}): ${errSel.message}`);
  const codigos = ((filas ?? []) as Array<{ reference_code: string | null }>).map(
    (f) => f.reference_code,
  );
  return formatearReferencia(prefijo, anio, siguienteNumero(codigos));
}
