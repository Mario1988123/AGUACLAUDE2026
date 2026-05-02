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
    .in("status", ["scheduled", "in_progress"]);
  if ((existing ?? 0) > 0) return 0;

  const totalMonths = c.maintenance_months_included ?? c.duration_months ?? 12;
  const periodicity = c.maintenance_periodicity_months;
  const numJobs = Math.floor(totalMonths / periodicity);
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
      status: "scheduled",
      scheduled_at: scheduled.toISOString(),
      is_charged: false,
    });
  }
  const { error } = await a.from("maintenance_jobs").insert(jobs);
  if (error) return 0;
  return jobs.length;
}
