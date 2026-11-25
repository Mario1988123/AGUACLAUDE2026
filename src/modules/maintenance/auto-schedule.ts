// Sin "use server" (auditoría 2026-10-01): son funciones internas que llaman
// otras acciones y los crons con el admin client. Como server actions quedaban
// invocables desde el navegador con cualquier id de contrato o empresa.

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sumarMesesMadrid } from "@/modules/scheduling/fechas-madrid";
import {
  fechasTeoricasContrato,
  serieEquipo,
  yaExisteVisita,
  type VisitaExistente,
} from "./calendario-visitas";
import { cargarCatalogoModelo } from "@/modules/equipos-modelo/datos";
import { esTipoEquipo, tipoEfectivoProducto } from "@/modules/equipos-modelo/logica";
import {
  elegirEquipoMantenimiento,
  esPackRole,
  llevaMantenimiento,
  tipoSinMantenimiento,
  type EquipoCandidatoMant,
} from "@/shared/lib/packs/complemento";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface FilaEquipoMant {
  id: string;
  product_id?: string | null;
  tipo_equipo?: string | null;
  parent_equipment_id?: string | null;
  pack_role?: string | null;
}

/**
 * Lee equipos activos con lo necesario para decidir quién lleva el
 * mantenimiento. Defensivo: pack_role, tipo_equipo y parent_equipment_id son
 * de migraciones posteriores; si faltan se cae a columnas más básicas.
 */
async function leerEquiposMant(
  a: Admin,
  filtrar: (q: Admin) => Admin,
): Promise<FilaEquipoMant[]> {
  const columnas = [
    "id, product_id, tipo_equipo, parent_equipment_id, pack_role",
    "id, product_id, tipo_equipo, parent_equipment_id",
    "id, product_id, parent_equipment_id",
    "id, product_id",
  ];
  for (const cols of columnas) {
    const r = await filtrar(a.from("customer_equipment").select(cols).eq("is_active", true));
    if (!r.error) return (r.data ?? []) as FilaEquipoMant[];
  }
  return [];
}

// El cron diario llama a ensureMaintenanceWindow por cada contrato y fuera de
// una petición `cache` de React no memoriza: se guarda el catálogo un minuto
// por empresa para no leer todos los productos en cada contrato.
const catalogoReciente = new Map<
  string,
  { en: number; cat: Awaited<ReturnType<typeof cargarCatalogoModelo>> }
>();
async function catalogoTipos(companyId: string) {
  const hit = catalogoReciente.get(companyId);
  if (hit && Date.now() - hit.en < 60_000) return hit.cat;
  const cat = await cargarCatalogoModelo(companyId);
  catalogoReciente.set(companyId, { en: Date.now(), cat });
  return cat;
}

async function aCandidatos(
  companyId: string,
  filas: FilaEquipoMant[],
): Promise<EquipoCandidatoMant[]> {
  let tipoDe: (productId: string | null) => string | null = () => null;
  try {
    const cat = await catalogoTipos(companyId);
    tipoDe = (productId) => tipoEfectivoProducto(productId, cat);
  } catch (e) {
    console.error("[auto-schedule] catálogo de tipos:", e);
  }
  return filas.map((f) => ({
    id: f.id,
    parent_equipment_id: f.parent_equipment_id ?? null,
    pack_role: esPackRole(f.pack_role) ? f.pack_role : null,
    // Manda el tipo identificado en el equipo; si no hay, el del producto.
    tipo: (esTipoEquipo(f.tipo_equipo) ? f.tipo_equipo : null) ?? tipoDe(f.product_id ?? null),
  }));
}

/**
 * Equipo del que se cuelgan las visitas de un contrato (plan Horeca, F3):
 * primero los equipos de ESE contrato (sus instalaciones) y, si no hay
 * (contratos antiguos o importados), los del cliente como antes. Dentro, la
 * parte del pack que lleva mantenimiento: nunca un Horeca ni un extra.
 */
export async function equipoMantenimientoDeContrato(
  a: Admin,
  c: { id: string; company_id: string; customer_id: string },
): Promise<{ id: string | null; sinMantenimiento: boolean }> {
  const { data: inst, error: instErr } = await a
    .from("installations")
    .select("id")
    .eq("company_id", c.company_id)
    .eq("contract_id", c.id);
  const instIds = instErr ? [] : ((inst ?? []) as Array<{ id: string }>).map((i) => i.id);
  if (instIds.length > 0) {
    const delContrato = await aCandidatos(
      c.company_id,
      await leerEquiposMant(a, (q) =>
        q.eq("company_id", c.company_id).in("installation_id", instIds),
      ),
    );
    // Solo vale si alguna parte lleva mantenimiento; si no, como antes: la
    // lista del cliente.
    if (delContrato.some(llevaMantenimiento)) return elegirEquipoMantenimiento(delContrato);
  }
  const delCliente = await aCandidatos(
    c.company_id,
    await leerEquiposMant(a, (q) =>
      q.eq("company_id", c.company_id).eq("customer_id", c.customer_id),
    ),
  );
  return elegirEquipoMantenimiento(delCliente);
}

/** ¿El equipo es de un tipo sin mantenimiento propio (Horeca)? Fail-soft: false. */
export async function equipoSinMantenimientoPropio(
  companyId: string,
  equipmentId: string,
): Promise<boolean> {
  try {
    const a = createAdminClient() as Admin;
    const filas = await leerEquiposMant(a, (q) =>
      q.eq("company_id", companyId).eq("id", equipmentId),
    );
    if (filas.length === 0) return false;
    const [cand] = await aCandidatos(companyId, filas);
    return tipoSinMantenimiento(cand?.tipo);
  } catch {
    return false;
  }
}

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

  // [decide] Sin fecha de inicio de servicio no se programa nada. Antes se
  // usaba `created_at` como base y, al fijarse service_start_date en la
  // instalación, la serie se desplazaba y se creaban visitas duplicadas
  // (la deduplicación solo tolera ±2 días). El cron diario y el cierre de la
  // instalación vuelven a llamar a esta función cuando ya hay fecha.
  if (!c.service_start_date) return 0;
  const baseDate = new Date(c.service_start_date);

  // Construir las fechas teóricas del contrato y elegir las que caen en
  // la ventana [hoy, hoy + monthsAhead].
  const now = new Date();
  // Sumas de meses sin desbordar y en hora de Madrid (auditoría I35).
  const windowEnd = sumarMesesMadrid(now, monthsAhead);

  const candidates = fechasTeoricasContrato({
    base: baseDate,
    periodicidadMeses: periodicity,
    totalVisitas: totalJobs,
    desde: now,
    hasta: windowEnd,
  }).map((c) => ({ idx: c.idx, scheduledAt: c.fecha }));
  if (candidates.length === 0) return 0;

  // Existentes en BD para no duplicar — tolerancia ±2 días. Se compara con
  // la fecha ORIGINAL además de la actual: si el cliente movió la visita del
  // 10 al 20, la del 10 no se vuelve a crear (auditoría I35).
  const { data: existing, error: errExisting } = await a
    .from("maintenance_jobs")
    .select("id, scheduled_at, original_scheduled_at, status")
    .eq("contract_id", contractId)
    .eq("kind", "contracted")
    .in("status", [
      "preprogrammed",
      "needs_callback",
      "scheduled",
      "in_progress",
      "completed",
      "cancelled",
      "rescheduled",
    ]);
  // Si no se pudo leer lo existente, no se crea nada (mejor que duplicar).
  if (errExisting) return 0;
  const existentes = (existing ?? []) as VisitaExistente[];
  const tolerance = 2 * 86400000;
  function alreadyExists(t: number): boolean {
    return yaExisteVisita(new Date(t), existentes, tolerance);
  }

  // Equipo (opcional). Antes se cogía el primer principal DEL CLIENTE, aunque
  // fuera de otro contrato (18 clientes de Infinity tienen 2+ principales).
  // Ahora: el equipo de ESTE contrato que lleva el mantenimiento (la ósmosis/UF
  // de un pack Horeca, nunca el Horeca ni un extra). Si todo es Horeca, no hay
  // visitas (el Horeca no tiene mantenimiento propio).
  const toCreate = candidates.filter((cd) => !alreadyExists(cd.scheduledAt.getTime()));
  if (toCreate.length === 0) return 0;

  const elegido = await equipoMantenimientoDeContrato(a, c);
  if (elegido.sinMantenimiento) return 0;
  const equipmentId = elegido.id;

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
  // El Horeca no recibe visitas (Mario 2026-11-25): las lleva su ósmosis/UF.
  if (await equipoSinMantenimientoPropio(input.company_id, input.customer_equipment_id)) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = createAdminClient() as any;

  const now = new Date();
  const windowEnd = sumarMesesMadrid(now, monthsAhead);

  // Construir fechas: firstDue, +periodicity, ... mientras quepan en la
  // ventana. Sin desbordar el día ni mover la hora de Madrid (auditoría I35).
  const candidates = serieEquipo({
    primera: input.firstDue,
    periodicidadMeses: input.periodicity_months,
    ahora: now,
    hasta: windowEnd,
  });
  if (candidates.length === 0) return 0;

  // Idempotencia: no duplicar jobs ya existentes de este equipo (±7 días).
  const { data: existing } = await a
    .from("maintenance_jobs")
    .select("scheduled_at, original_scheduled_at")
    .eq("company_id", input.company_id)
    .eq("customer_equipment_id", input.customer_equipment_id)
    .in("status", [
      "preprogrammed",
      "needs_callback",
      "scheduled",
      "in_progress",
      "completed",
      "rescheduled",
    ]);
  const tol = 7 * 86400000;
  const existentes = (existing ?? []) as VisitaExistente[];
  const toCreate = candidates.filter((c) => !yaExisteVisita(c, existentes, tol));
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
