"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Genera maintenance_jobs en estado "scheduled" para un contrato activo.
 * Si el contrato tiene maintenance_included y maintenance_periodicity_months,
 * crea N jobs equiespaciados en el rango de maintenance_months_included
 * (o duration_months como fallback).
 *
 * Idempotente: si ya existen jobs scheduled para el contrato, no duplica.
 */
export async function autoScheduleMaintenanceForContract(contractId: string): Promise<number> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any;

  const { data: contract } = await a
    .from("contracts")
    .select(
      "id, company_id, customer_id, status, maintenance_included, maintenance_months_included, maintenance_periodicity_months, duration_months, service_start_date",
    )
    .eq("id", contractId)
    .single();

  if (!contract) return 0;
  const c = contract as {
    id: string;
    company_id: string;
    customer_id: string;
    status: string;
    maintenance_included: boolean;
    maintenance_months_included: number | null;
    maintenance_periodicity_months: number | null;
    duration_months: number | null;
    service_start_date: string | null;
  };
  if (!c.maintenance_included || !c.maintenance_periodicity_months) return 0;

  const { count: existing } = await a
    .from("maintenance_jobs")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId)
    .eq("kind", "contracted")
    .in("status", ["preprogrammed", "scheduled", "in_progress"]);
  if ((existing ?? 0) > 0) return 0;

  const totalMonths = c.maintenance_months_included ?? c.duration_months ?? 12;
  const periodicity = c.maintenance_periodicity_months;
  // Regla de cobertura por filtros (decisión usuario 2026-05-19):
  //   - Cada visita instala filtros que cubren `periodicity` meses.
  //   - La última visita NO es necesaria si su cobertura llega al fin
  //     del contrato. Ej.: 48 meses con periodicidad 12 → visitas en
  //     mes 12, 24, 36 (la del mes 36 cubre 36→48). No mes 48.
  //   - Si NO es múltiplo exacto, sí que necesita una visita final
  //     adicional para no dejar meses descubiertos.
  let numJobs = Math.floor(totalMonths / periodicity);
  if (totalMonths % periodicity === 0 && numJobs > 0) {
    numJobs -= 1;
  }
  if (numJobs <= 0) return 0;

  const { data: equipment } = await a
    .from("customer_equipment")
    .select("id")
    .eq("customer_id", c.customer_id)
    .eq("is_active", true);
  const eqList = (equipment ?? []) as Array<{ id: string }>;
  const equipmentId = eqList[0]?.id ?? null;

  // Anclamos las fechas de mantenimiento al inicio del servicio (no al "ahora").
  // Si el contrato arranca el 01/05 y la periodicidad es 6 meses → 01/11, 01/05+1y…
  const baseDate = c.service_start_date ? new Date(c.service_start_date) : new Date();
  const jobs = [] as Array<Record<string, unknown>>;
  for (let n = 1; n <= numJobs; n++) {
    const scheduled = new Date(baseDate);
    scheduled.setMonth(scheduled.getMonth() + n * periodicity);
    jobs.push({
      company_id: c.company_id,
      customer_id: c.customer_id,
      customer_equipment_id: equipmentId,
      contract_id: c.id,
      kind: "contracted",
      // Estado preliminar (decisión 2026-05-19): la visita se crea como
      // "preprogrammed" y un admin/TMK debe confirmarla con el cliente
      // antes de pasarla a "scheduled" (ya en la agenda real).
      status: "preprogrammed",
      scheduled_at: scheduled.toISOString(),
      is_charged: false,
    });
  }
  const { error } = await a.from("maintenance_jobs").insert(jobs);
  if (error) {
    // Fallback: si el enum aún no tiene 'preprogrammed' (migración no
    // aplicada todavía), creamos como 'scheduled' para no romper el
    // flujo en producción durante el despliegue.
    if (/invalid input value for enum|preprogrammed/i.test(error.message)) {
      const jobsLegacy = jobs.map((j) => ({ ...j, status: "scheduled" }));
      const { error: err2 } = await a.from("maintenance_jobs").insert(jobsLegacy);
      if (err2) return 0;
      return jobsLegacy.length;
    }
    return 0;
  }
  return jobs.length;
}
