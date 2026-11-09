import "server-only";

/**
 * NÚCLEO del cierre de un contrato con cuota (alquiler / renting): lo usan
 * `finalizeRentalContractAction` (cierre manual desde la ficha del contrato)
 * y la retirada de equipos (al retirar el equipo se deja de cobrar).
 *
 * Qué hace, y nada más:
 *  1. Pasa el contrato de signed/active a `completed` con compare-and-set
 *     (dos llamadas a la vez → solo una lo cierra).
 *  2. Cancela TODOS sus mantenimientos pendientes (no completed / cancelled /
 *     in_progress).
 * El cron de cuotas (`/api/cron/daily`, día 1) solo factura contratos
 * `active`, así que desde ese momento no se generan más cuotas. NO toca
 * facturas ni cobros ya emitidos y NO hace prorrateo ni penalización: la
 * fianza (devolver / retener) la decide `finalizeRentalContractAction`.
 *
 * No es una server action: recibe el admin client y el company_id ya
 * verificados por quien lo llama.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const ESTADOS_CONTRATO_FINALIZABLES = ["signed", "active"] as const;

/** Compare-and-set a 'completed'. `cerrado=false` si ya no estaba en signed/active. */
export async function marcarContratoCompletado(
  admin: Admin,
  companyId: string,
  contractId: string,
): Promise<{ cerrado: boolean }> {
  const { data, error } = await admin
    .from("contracts")
    .update({ status: "completed" })
    .eq("id", contractId)
    .eq("company_id", companyId)
    .in("status", ESTADOS_CONTRATO_FINALIZABLES as unknown as string[])
    .select("id");
  if (error) throw new Error(error.message);
  return { cerrado: ((data ?? []) as unknown[]).length > 0 };
}

/** Deshace `marcarContratoCompletado` (solo si sigue en completed). */
export async function revertirContratoCompletado(
  admin: Admin,
  companyId: string,
  contractId: string,
  estadoPrevio: string,
): Promise<void> {
  const { error } = await admin
    .from("contracts")
    .update({ status: estadoPrevio })
    .eq("id", contractId)
    .eq("company_id", companyId)
    .eq("status", "completed");
  if (error) console.error("[finalizarContrato] revertir:", error.message);
}

/**
 * Estados de mantenimiento que se cancelan al finalizar un contrato o retirar
 * el equipo (Mario 2026-11-09): todo lo pendiente. Enum real
 * app.maintenance_status: preprogrammed, needs_callback, scheduled,
 * in_progress, completed, cancelled, rescheduled. Se quedan como están
 * `completed`, `cancelled` e `in_progress` (hay un técnico en ello ahora).
 */
export const ESTADOS_MANTENIMIENTO_NO_CANCELABLES = "(completed,cancelled,in_progress)";

/** Cancela TODOS los mantenimientos pendientes del contrato. */
export async function cancelarMantenimientosProgramadosContrato(
  admin: Admin,
  companyId: string,
  contractId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("maintenance_jobs")
    .update({ status: "cancelled" })
    .eq("contract_id", contractId)
    .eq("company_id", companyId)
    .is("completed_at", null)
    .not("status", "in", ESTADOS_MANTENIMIENTO_NO_CANCELABLES)
    .select("id");
  if (error) {
    console.error("[finalizarContrato] cancelar mantenimientos:", error.message);
    return 0;
  }
  return ((data ?? []) as unknown[]).length;
}
