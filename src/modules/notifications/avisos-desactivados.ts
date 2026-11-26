import "server-only";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Avisos que una empresa ha APAGADO (Mario 2026-11-26: «Infinity usa la app sin
 * ver el stock; los avisos de stock ahora son mucho ruido»).
 *
 * Se guarda en `company_settings.extra.avisos_desactivados`: una lista de
 * `kind` de notificación. `notify` y `notifyByRoles` no crean ni la
 * notificación ni el push de esos kinds, y los crons que calculan avisos de
 * stock se saltan la empresa.
 *
 * Hoy la pantalla solo ofrece el grupo «stock». El mecanismo vale para
 * cualquier kind, pero muchos avisos se insertan directamente en
 * `notifications` sin pasar por el notifier: antes de ofrecer otro interruptor
 * hay que comprobar que su kind pasa por `notify`/`notifyByRoles`.
 */

/** Kinds del grupo «Avisos de stock». */
export const KINDS_AVISOS_STOCK = [
  "stock.low", // cron diario: stock por debajo del mínimo
  "installation.stock_shortage", // falta stock al programar una instalación
  "warehouse.purchase_suggestion", // cron de sugerencias de pedido
] as const;

/** Clave que delata el grupo stock dentro de la lista guardada. */
const KIND_TESTIGO_STOCK = "stock.low";

export function listaDesdeExtra(extra: unknown): string[] {
  const v = (extra as Record<string, unknown> | null)?.avisos_desactivados;
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}

/** Kinds apagados de una empresa. Falla ABIERTO: ante error, nada apagado. */
export async function avisosDesactivados(admin: Admin, companyId: string): Promise<Set<string>> {
  try {
    const { data, error } = await admin
      .from("company_settings")
      .select("extra")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) return new Set();
    return new Set(listaDesdeExtra(data?.extra));
  } catch {
    return new Set();
  }
}

export async function avisoDesactivado(admin: Admin, companyId: string, kind: string): Promise<boolean> {
  return (await avisosDesactivados(admin, companyId)).has(kind);
}

export function stockApagadoEn(lista: Iterable<string>): boolean {
  for (const k of lista) if (k === KIND_TESTIGO_STOCK) return true;
  return false;
}

/** ¿Tiene la empresa apagados los avisos de stock? Falla abierto (false). */
export async function avisosStockApagados(admin: Admin, companyId: string): Promise<boolean> {
  return stockApagadoEn(await avisosDesactivados(admin, companyId));
}

/**
 * Empresas con los avisos de stock apagados, para los crons (una consulta por
 * ejecución). Falla ABIERTO: ante error devuelve el conjunto vacío y el cron
 * se comporta como siempre.
 */
export async function empresasConAvisosStockApagados(admin: Admin): Promise<Set<string>> {
  try {
    const { data, error } = await admin
      .from("company_settings")
      .select("company_id")
      .contains("extra", { avisos_desactivados: [KIND_TESTIGO_STOCK] });
    if (error) {
      console.error("[avisos-desactivados]", error.message);
      return new Set();
    }
    return new Set(((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id));
  } catch {
    return new Set();
  }
}
