/**
 * Reglas puras de acceso a hilos del chat (sin I/O, para poder testearlas).
 *
 * - Un hilo solo es legible por usuarios de su misma empresa.
 * - Los hilos `broadcast` (avisos generales) los lee toda la empresa.
 * - Los hilos `team` y `direct` solo los leen sus miembros.
 *
 * La misma regla está replicada en la RLS (`app.chat_puede_leer_hilo`), que es
 * la que protege Realtime; esta copia es la que usan las server actions, que
 * trabajan con el admin client y se saltan la RLS.
 */

export type TipoHilo = "broadcast" | "team" | "direct";

export interface HiloMinimo {
  kind: TipoHilo;
  company_id: string;
}

export function puedeLeerHilo(
  hilo: HiloMinimo | null | undefined,
  companyIdSesion: string | null | undefined,
  esMiembro: boolean,
): boolean {
  if (!hilo || !companyIdSesion) return false;
  if (hilo.company_id !== companyIdSesion) return false;
  if (hilo.kind === "broadcast") return true;
  return esMiembro;
}

/** Máximo de valores que admite un filtro `in` de Supabase Realtime. */
export const MAX_HILOS_FILTRO_REALTIME = 100;

/**
 * Construye el filtro de Realtime `thread_id=in.(…)` para escuchar solo los
 * hilos del usuario. Devuelve null si no hay hilos (no hay nada que escuchar).
 * Solo admite UUID para que un id raro no rompa la sintaxis del filtro.
 */
export function filtroRealtimeHilos(ids: readonly string[]): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const limpios = Array.from(new Set(ids.filter((id) => uuid.test(id)))).slice(
    0,
    MAX_HILOS_FILTRO_REALTIME,
  );
  if (limpios.length === 0) return null;
  return `thread_id=in.(${limpios.join(",")})`;
}
