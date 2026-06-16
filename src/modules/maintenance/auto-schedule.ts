"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

/**
 * Garantiza que un contrato con mantenimiento incluido tiene preprogrammed
 * (en estado `preprogrammed`) los mantenimientos que caen en los próximos
 * `monthsAhead` meses (default 12). Idea: no se crean los 48 meses de
 * golpe — se van rellenando año a año. El cron diario llama a esto para
 * cada contrato activo, así que siempre hay 12 meses por delante.
 *
 * Reglas:
 *  - Fecha base: `service_start_date` del contrato (o `created_at` si
 *    falta). Las visitas teóricas son base + N * periodicity.
 *  - Solo se crean las visitas teóricas que cumplen TODO esto:
 *      · están dentro de la ventana [hoy, hoy + monthsAhead].
 *      · no superan el final del contrato (totalMonths desde base).
 *      · no son la última visita si la cobertura ya alcanza el fin del
 *        contrato (regla cobertura de filtros, ver más abajo).
 *      · no existen ya como job para ese contrato+fecha (idempotencia
 *        defensiva — admite tolerancia de ±1 día).
 *  - No se tocan jobs en `scheduled`/`in_progress`/`completed`/`cancelled`.
 *
 * Cobertura de filtros (decisión usuario 2026-05-19): cada visita instala
 * filtros para `periodicity` meses; la última visita es opcional si su
 * cobertura llega al fin del contrato. Ej. 48m con periodicidad 12 →
 * visitas mes 12, 24, 36 (cubre 36→48). No mes 48.
 *
 * Devuelve el número de jobs creados.
 */
export async function ensureMaintenanceWindow(
  contractId: string,
  monthsAhead = 12,
): Promise<number> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any;

  const { data: contract } = await a
    .from("contracts")
    .select(
      "id, company_id, customer_id, status, maintenance_included, maintenance_months_included, maintenance_periodicity_months, duration_months, service_start_date, created_at",
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
    created_at: string;
  };
  if (!c.maintenance_included || !c.maintenance_periodicity_months) return 0;

  // No regenerar mantenimientos si el cliente está dado de baja / inactivo
  // (flujo "Borrar cliente": dejó de querer nuestro servicio). Sin este freno,
  // el cron diario volvería a crear las visitas futuras de un cliente perdido.
  try {
    const { data: cust } = await a
      .from("customers")
      .select("is_active")
      .eq("id", c.customer_id)
      .maybeSingle();
    if ((cust as { is_active: boolean | null } | null)?.is_active === false) {
      return 0;
    }
  } catch {
    /* fail-soft: si no se pudo comprobar, seguimos como antes */
  }

  const totalMonths = c.maintenance_months_included ?? c.duration_months ?? 12;
  const periodicity = c.maintenance_periodicity_months;

  // Calcular cuántas visitas tiene el contrato en total (regla cobertura).
  let totalJobs = Math.floor(totalMonths / periodicity);
  if (totalMonths % periodicity === 0 && totalJobs > 0) totalJobs -= 1;
  if (totalJobs <= 0) return 0;

  const baseDate = c.service_start_date
    ? new Date(c.service_start_date)
    : new Date(c.created_at);

  // Construir las fechas teóricas del contrato y elegir las que caen en
  // la ventana [hoy, hoy + monthsAhead].
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setMonth(windowEnd.getMonth() + monthsAhead);

  const candidates: { idx: number; scheduledAt: Date }[] = [];
  for (let n = 1; n <= totalJobs; n++) {
    const d = new Date(baseDate);
    d.setMonth(d.getMonth() + n * periodicity);
    if (d.getTime() >= now.getTime() && d.getTime() <= windowEnd.getTime()) {
      candidates.push({ idx: n, scheduledAt: d });
    }
  }
  if (candidates.length === 0) return 0;

  // Existentes en BD para no duplicar — tolerancia ±2 días en la fecha
  // por si previous runs lo dejaron en un día ligeramente distinto.
  const { data: existing } = await a
    .from("maintenance_jobs")
    .select("id, scheduled_at, status")
    .eq("contract_id", contractId)
    .eq("kind", "contracted")
    .in("status", [
      "preprogrammed",
      "scheduled",
      "in_progress",
      "completed",
      "cancelled",
      "rescheduled",
    ]);
  type EJ = { id: string; scheduled_at: string | null; status: string };
  const existingDates = ((existing ?? []) as EJ[])
    .map((e) => (e.scheduled_at ? new Date(e.scheduled_at).getTime() : null))
    .filter((t): t is number => t !== null);
  const tolerance = 2 * 86400000;
  function alreadyExists(t: number): boolean {
    return existingDates.some((e) => Math.abs(e - t) < tolerance);
  }

  // Equipment (opcional, mismo criterio que antes)
  const { data: equipment } = await a
    .from("customer_equipment")
    .select("id")
    .eq("customer_id", c.customer_id)
    .eq("is_active", true);
  const eqList = (equipment ?? []) as Array<{ id: string }>;
  const equipmentId = eqList[0]?.id ?? null;

  const toCreate = candidates.filter((cd) => !alreadyExists(cd.scheduledAt.getTime()));
  if (toCreate.length === 0) return 0;

  const jobs = toCreate.map((cd) => ({
    company_id: c.company_id,
    customer_id: c.customer_id,
    customer_equipment_id: equipmentId,
    contract_id: c.id,
    kind: "contracted",
    status: "preprogrammed" as const,
    scheduled_at: cd.scheduledAt.toISOString(),
    // Conservamos la fecha original que propuso el cron para auditoría —
    // si admin/TMK la mueve al confirmar con el cliente, scheduled_at
    // cambia pero esto se queda como referencia.
    original_scheduled_at: cd.scheduledAt.toISOString(),
    is_charged: false,
  }));

  const { error } = await a.from("maintenance_jobs").insert(jobs);
  if (error) {
    // Fallback: si el enum aún no tiene 'preprogrammed' (migración
    // pendiente), creamos como 'scheduled' para no romper el flujo.
    if (/invalid input value for enum|preprogrammed/i.test(error.message)) {
      const legacy = jobs.map((j) => ({ ...j, status: "scheduled" as const }));
      const { error: err2 } = await a.from("maintenance_jobs").insert(legacy);
      if (err2) return 0;
      return legacy.length;
    }
    return 0;
  }
  return jobs.length;
}

/**
 * Genera la SERIE de mantenimientos preventivos de un EQUIPO concreto (sin
 * contrato), según una periodicidad en meses, para los próximos `monthsAhead`
 * meses (default 12). Lo usa el alta manual de equipo y la importación de
 * clientes con histórico. Idempotente (tolerancia ±7 días, fechas aproximadas).
 *
 * `firstDue` = fecha del PRÓXIMO mantenimiento (si se conoce). Si cae en el
 * pasado, se adelanta sumando periodicidades hasta hoy. Devuelve nº de jobs.
 */
export async function generateEquipmentMaintenanceWindow(input: {
  company_id: string;
  customer_id: string;
  customer_equipment_id: string;
  periodicity_months: number;
  firstDue: Date;
  monthsAhead?: number;
}): Promise<number> {
  const monthsAhead = input.monthsAhead ?? 12;
  if (!input.periodicity_months || input.periodicity_months <= 0) return 0;
  if (isNaN(input.firstDue.getTime())) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = createAdminClient() as any;

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setMonth(windowEnd.getMonth() + monthsAhead);

  // Construir fechas: firstDue, +periodicity, ... mientras quepan en la ventana.
  const candidates: Date[] = [];
  let d = new Date(input.firstDue);
  let guard = 0;
  // Adelantar al futuro si firstDue ya pasó.
  while (d.getTime() < now.getTime() && guard < 120) {
    d = new Date(d);
    d.setMonth(d.getMonth() + input.periodicity_months);
    guard++;
  }
  guard = 0;
  while (d.getTime() <= windowEnd.getTime() && guard < 60) {
    candidates.push(new Date(d));
    const nd = new Date(d);
    nd.setMonth(nd.getMonth() + input.periodicity_months);
    d = nd;
    guard++;
  }
  if (candidates.length === 0) return 0;

  // Idempotencia: no duplicar jobs ya existentes de este equipo (±7 días).
  const { data: existing } = await a
    .from("maintenance_jobs")
    .select("scheduled_at")
    .eq("company_id", input.company_id)
    .eq("customer_equipment_id", input.customer_equipment_id)
    .in("status", ["preprogrammed", "scheduled", "in_progress", "completed", "rescheduled"]);
  const existingTimes = ((existing ?? []) as Array<{ scheduled_at: string | null }>)
    .map((e) => (e.scheduled_at ? new Date(e.scheduled_at).getTime() : null))
    .filter((t): t is number => t !== null);
  const tol = 7 * 86400000;
  const toCreate = candidates.filter(
    (c) => !existingTimes.some((e) => Math.abs(e - c.getTime()) < tol),
  );
  if (toCreate.length === 0) return 0;

  const jobs = toCreate.map((dt) => ({
    company_id: input.company_id,
    customer_id: input.customer_id,
    customer_equipment_id: input.customer_equipment_id,
    kind: "contracted",
    status: "preprogrammed" as const,
    scheduled_at: dt.toISOString(),
    original_scheduled_at: dt.toISOString(),
    is_charged: false,
  }));
  const { error } = await a.from("maintenance_jobs").insert(jobs);
  if (error) {
    if (/invalid input value for enum|preprogrammed/i.test(error.message ?? "")) {
      const legacy = jobs.map((j) => ({ ...j, status: "scheduled" as const }));
      const { error: e2 } = await a.from("maintenance_jobs").insert(legacy);
      if (e2) return 0;
      return legacy.length;
    }
    return 0;
  }
  return jobs.length;
}

/**
 * @deprecated Usa `ensureMaintenanceWindow(contractId, 12)`. Antes esto
 * generaba TODOS los mantenimientos del contrato de golpe (hasta 7-8
 * para contratos largos) — ahora preferimos la ventana 12m.
 */
export async function autoScheduleMaintenanceForContract(
  contractId: string,
): Promise<number> {
  return ensureMaintenanceWindow(contractId, 12);
}
