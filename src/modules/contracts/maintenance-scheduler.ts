"use server";

import { createClient } from "@/shared/lib/supabase/server";

/**
 * Genera maintenance_jobs futuros a partir de la configuración del contrato:
 *   - maintenance_included = true
 *   - maintenance_periodicity_months > 0
 *   - maintenance_months_included > 0 (cuántos meses cubre el contrato; si
 *     no está definido, se usa la duración del contrato; si tampoco, 12)
 *
 * Punto de partida: la fecha de servicio (service_start_date) si existe,
 * si no signed_at, si no created_at. Crea jobs en estado 'scheduled' sin
 * técnico asignado y sin hora concreta (00:00) para que el admin los
 * planifique luego. Idempotente: si ya hay jobs futuros para el contrato,
 * no duplica.
 */
export async function scheduleMaintenanceForContract(
  contractId: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: contract } = await supabase
    .from("contracts")
    .select(
      "id, company_id, customer_id, maintenance_included, maintenance_months_included, maintenance_periodicity_months, duration_months, service_start_date, signed_at, created_at",
    )
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) return 0;
  const c = contract as {
    id: string;
    company_id: string;
    customer_id: string;
    maintenance_included: boolean;
    maintenance_months_included: number | null;
    maintenance_periodicity_months: number | null;
    duration_months: number | null;
    service_start_date: string | null;
    signed_at: string | null;
    created_at: string;
  };
  if (!c.maintenance_included) return 0;
  const periodicity = c.maintenance_periodicity_months ?? 0;
  if (periodicity <= 0) return 0;
  const monthsCovered =
    c.maintenance_months_included ?? c.duration_months ?? 12;
  if (monthsCovered <= 0) return 0;

  const startSrc = c.service_start_date ?? c.signed_at ?? c.created_at;
  const start = new Date(startSrc);

  // ¿Ya hay jobs creados para este contrato? Si sí, no duplicar
  const { data: existing } = await supabase
    .from("maintenance_jobs")
    .select("id")
    .eq("contract_id", c.id)
    .limit(1);
  if (((existing ?? []) as Array<unknown>).length > 0) return 0;

  const occurrences = Math.floor(monthsCovered / periodicity);
  if (occurrences <= 0) return 0;

  const rows: Array<{
    company_id: string;
    customer_id: string;
    contract_id: string;
    kind: string;
    status: string;
    scheduled_at: string;
    is_charged: boolean;
    notes: string;
  }> = [];
  for (let i = 1; i <= occurrences; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * periodicity);
    // Normalizamos a las 09:00 locales
    d.setHours(9, 0, 0, 0);
    rows.push({
      company_id: c.company_id,
      customer_id: c.customer_id,
      contract_id: c.id,
      kind: "preventive",
      status: "scheduled",
      scheduled_at: d.toISOString(),
      is_charged: false,
      notes: `Mantenimiento preventivo programado automáticamente (#${i} de ${occurrences})`,
    });
  }
  if (rows.length === 0) return 0;
  await supabase.from("maintenance_jobs").insert(rows);
  return rows.length;
}
