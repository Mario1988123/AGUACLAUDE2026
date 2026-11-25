import "server-only";
import { ESTADOS_EN_SERVICIO, empresaEnServicio } from "./estado";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Empresas EN SERVICIO (trial o active) para los procesos automáticos.
 *
 * Mario 2026-11-28: una empresa pausada (suspended) o de baja (cancelled) no
 * genera NADA automático: ni avisos, ni correos, ni push, ni WhatsApp, ni
 * visitas, ni cobros. No se borra nada: solo se filtra. Cada cron pide la
 * lista UNA vez al empezar y la aplica en su consulta raíz
 * (`.in("company_id", ids)`) o en su bucle (`enServicio.has(id)`).
 *
 * Falla CERRADO: si no se puede leer `companies` (dos intentos), lanza. El
 * cron lo registra y esa ejecución no genera nada; la siguiente lo recupera.
 * Mejor un día sin avisos que avisos de una empresa en pausa.
 */
export interface EmpresasEnServicio {
  ids: string[];
  has: (companyId: string | null | undefined) => boolean;
}

export async function empresasEnServicio(admin: Admin): Promise<EmpresasEnServicio> {
  let ultimoError: string | null = null;
  for (let intento = 0; intento < 2; intento++) {
    const { data, error } = await admin
      .from("companies")
      .select("id, status")
      .in("status", ESTADOS_EN_SERVICIO as string[]);
    if (!error) {
      const ids = ((data ?? []) as Array<{ id: string; status: string | null }>)
        .filter((c) => empresaEnServicio(c.status))
        .map((c) => c.id);
      const set = new Set(ids);
      return { ids, has: (id) => !!id && set.has(id) };
    }
    ultimoError = error.message ?? String(error);
  }
  throw new Error(`No se pudo leer qué empresas están en servicio: ${ultimoError}`);
}

/**
 * ¿Está en servicio esta empresa? Para procesos de UNA empresa (webhooks,
 * colas por empresa). Falla cerrado: ante error devuelve false.
 */
export async function empresaEstaEnServicio(admin: Admin, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const { data, error } = await admin.from("companies").select("status").eq("id", companyId).maybeSingle();
  if (error) {
    console.error("[empresaEstaEnServicio]", error.message);
    return false;
  }
  return empresaEnServicio((data as { status?: string | null } | null)?.status);
}

/**
 * Para pasar a `.in("company_id", …)`: PostgREST con lista vacía da error, así
 * que sin empresas en servicio se usa un id imposible (no casa con nada).
 */
export function idsParaFiltro(e: EmpresasEnServicio): string[] {
  return e.ids.length > 0 ? e.ids : ["00000000-0000-0000-0000-000000000000"];
}

/** Texto del cron que se para porque no ha podido leer las empresas en servicio. */
export const MOTIVO_SIN_EMPRESAS =
  "No se pudo leer qué empresas están en servicio: esta ejecución no genera nada";

/**
 * Para la campana y /notificaciones: ids de empresas en servicio, para no
 * enseñar avisos de una empresa pausada o de baja a quien esté en varias.
 * Aquí falla ABIERTO (null = no filtrar): mejor ver un aviso de más que
 * quedarse sin campana por un fallo de lectura.
 */
export async function idsEmpresasEnServicioOTodas(): Promise<string[] | null> {
  try {
    const { createAdminClient } = await import("@/shared/lib/supabase/admin");
    return idsParaFiltro(await empresasEnServicio(createAdminClient()));
  } catch (e) {
    console.error("[idsEmpresasEnServicioOTodas]", e);
    return null;
  }
}

/** Aplica `.in("company_id", ids)` solo si hay lista (null = sin filtro). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function soloVisibles<T extends { in: (col: string, v: string[]) => any }>(q: T, ids: string[] | null): T {
  return ids ? (q.in("company_id", ids) as T) : q;
}
