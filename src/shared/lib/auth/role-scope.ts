import { createAdminClient } from "@/shared/lib/supabase/admin";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import type { SessionClaims } from "./session";

/**
 * Resuelve el conjunto de user_ids visibles para la sesión actual
 * según las reglas de scope (decisión usuario 2026-05-07):
 *
 *  · Nivel 1 (company_admin / superadmin): null → "todos los usuarios"
 *    (sin filtro). El caller usa null para no añadir cláusula.
 *
 *  · Nivel 2 (directores): self + miembros asignados via
 *    team_assignments (manager_user_id = self).
 *
 *  · Nivel 3 (sales_rep, telemarketer, installer): solo self.
 *
 * Devuelve `null` si es nivel 1 (no aplicar filtro), o `string[]` con
 * el listado de user_ids visibles. Si la lista está vacía el caller
 * debe devolver `[]` (no hay nada que ver).
 */
export async function resolveVisibleUserIds(
  session: SessionClaims,
): Promise<string[] | null> {
  if (session.is_superadmin || session.roles.includes("company_admin")) {
    return null; // sin filtro
  }
  const isLevel2 =
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");

  if (!isLevel2) {
    // Nivel 3: solo se ve a sí mismo
    return [session.user_id];
  }

  // Nivel 2: self + miembros asignados via team_assignments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("team_assignments")
      .select("member_user_id")
      .eq("company_id", session.company_id)
      .eq("manager_user_id", session.user_id)
      .is("revoked_at", null);
    type TA = { member_user_id: string };
    const ids = ((data ?? []) as TA[]).map((a) => a.member_user_id);
    return Array.from(new Set([session.user_id, ...ids]));
  } catch {
    // Fallback: solo se ve a sí mismo
    return [session.user_id];
  }
}

/**
 * ¿El usuario tiene una tarea ASIGNADA y ACTIVA para este cliente?
 *
 * Regla (2026-06-18): un técnico/instalador puede ver un cliente mientras tenga
 * una tarea asignada a él (agenda, instalación o mantenimiento) que NO esté
 * terminada ni cancelada. Cuando la completa, deja de verlo. Esto permite que el
 * scope normal (nivel 3 = solo lo suyo) se amplíe puntualmente al cliente de su
 * tarea, sin abrirle todo el CRM.
 *
 * Solo cuenta SUS asignaciones (assigned/installer/technician = session.user_id),
 * así que no expone clientes de otros. Defensivo: si una tabla/consulta falla,
 * se ignora (no concede acceso por ese camino).
 */
export async function hasActiveTaskForCustomer(
  session: SessionClaims,
  customerId: string,
): Promise<boolean> {
  if (!session.company_id || !customerId) return false;
  // Solo técnico (2026-11-12, D3+D4): mantenimientos e instalaciones suyos sin
  // cerrar o cerrados hace < 24 h. La agenda NO cuenta para él.
  if (esSoloTecnico(session)) return clientePendienteParaTecnico(session, customerId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const NOT_DONE = "(completed,cancelled)";

  // Tarea de agenda vinculada directamente al cliente.
  try {
    const { count } = await admin
      .from("agenda_events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("assigned_user_id", session.user_id)
      .eq("subject_type", "customer")
      .eq("subject_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  // Instalación asignada al técnico para este cliente.
  try {
    const { count } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("installer_user_id", session.user_id)
      .eq("customer_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  // Mantenimiento asignado al técnico para este cliente.
  try {
    const { count } = await admin
      .from("maintenance_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("technician_user_id", session.user_id)
      .eq("customer_id", customerId)
      .not("status", "in", NOT_DONE);
    if ((count ?? 0) > 0) return true;
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Días configurados por la empresa para que un comercial siga viendo a un
 * cliente tras venderle (company_settings.commercial_retention_days). 0 si no
 * está configurado o la columna aún no existe (defensivo).
 */
export async function getCommercialRetentionDays(companyId: string): Promise<number> {
  if (!companyId) return 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("company_settings")
      .select("commercial_retention_days")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return 0;
    return Number((data as { commercial_retention_days: number | null }).commercial_retention_days ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * IDs de clientes que un comercial (sales_rep, nivel 3) puede VER ADEMÁS de
 * los suyos asignados: aquellos a los que vendió (contrato firmado por él)
 * dentro de la ventana de retención configurada. Solo aplica a sales_rep puro;
 * para el resto de roles devuelve [] (no cambia su scope). La fecha de
 * referencia es contracts.signed_at (la venta). Defensivo ante fallos de BD.
 */
export async function getCommercialRetentionCustomerIds(
  session: SessionClaims,
): Promise<string[]> {
  if (!session.company_id) return [];
  if (session.is_superadmin || session.roles.includes("company_admin")) return [];
  if (isLevel2(session)) return [];
  if (!session.roles.includes("sales_rep")) return [];
  const days = await getCommercialRetentionDays(session.company_id);
  if (days <= 0) return [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // .limit(2000) no levantaba nada: PostgREST corta en max-rows (1000).
    const data = await fetchAllRows<{ customer_id: string | null }>(
      (from, to) =>
        admin
          .from("contracts")
          .select("customer_id")
          .eq("company_id", session.company_id)
          .eq("created_by", session.user_id)
          .not("signed_at", "is", null)
          .gte("signed_at", cutoff)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      { label: "retencionComercial" },
    );
    return Array.from(
      new Set(
        ((data ?? []) as Array<{ customer_id: string | null }>)
          .map((r) => r.customer_id)
          .filter((x): x is string => Boolean(x)),
      ),
    );
  } catch {
    return [];
  }
}

/**
 * ¿El comercial vendió a este cliente dentro de la ventana de retención?
 * Usado por la ficha de cliente para mantener el acceso del comercial
 * durante esos días aunque el cliente ya no esté asignado a él.
 */
export async function hasRecentSaleForCustomer(
  session: SessionClaims,
  customerId: string,
): Promise<boolean> {
  if (!session.company_id || !customerId) return false;
  if (session.is_superadmin || session.roles.includes("company_admin")) return false;
  if (!session.roles.includes("sales_rep")) return false;
  const days = await getCommercialRetentionDays(session.company_id);
  if (days <= 0) return false;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { count } = await admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", session.company_id)
      .eq("created_by", session.user_id)
      .eq("customer_id", customerId)
      .not("signed_at", "is", null)
      .gte("signed_at", cutoff)
      .is("deleted_at", null);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * ¿La sesión puede ver un registro cuyos "dueños" son estos user_ids?
 * (creador, comercial asignado, instalador…). Misma regla que los listados:
 * nivel 1 todo; nivel 2 lo de su equipo; nivel 3 solo lo suyo.
 * Decisión de Mario (2026-11-09) para los PDF de propuesta, ahorro y prueba
 * gratuita: cada comercial los suyos y el admin todos.
 */
export async function puedeVerRegistroPorDueno(
  session: SessionClaims,
  duenos: Array<string | null | undefined>,
): Promise<boolean> {
  const visibles = await resolveVisibleUserIds(session);
  if (visibles === null) return true;
  return duenos.some((d) => !!d && visibles.includes(d));
}

/**
 * Helpers de identificación de nivel (sin BD).
 */
export function isLevel1(session: SessionClaims): boolean {
  return session.is_superadmin || session.roles.includes("company_admin");
}
export function isLevel2(session: SessionClaims): boolean {
  return (
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director")
  );
}

// =====================================================================
// Permisos de técnicos (plan docs/PLAN_PERMISOS_TECNICOS.md, 2026-11-12)
// =====================================================================

/** Roles con vista amplia: si el usuario tiene alguno, NO es "solo técnico". */
const ROLES_NO_TECNICO = [
  "company_admin",
  "technical_director",
  "commercial_director",
  "telemarketing_director",
  "sales_rep",
  "telemarketer",
];

/**
 * ¿Es solo técnico? = installer sin ningún rol de nivel 1/2 ni comercial.
 * Es a quien se le recorta la vista (clientes pendientes, su furgoneta, sin
 * almacenes). Un técnico que también sea comercial conserva la vista amplia.
 */
export function esSoloTecnico(session: SessionClaims): boolean {
  if (session.is_superadmin) return false;
  if (!session.roles.includes("installer")) return false;
  return !session.roles.some((r) => ROLES_NO_TECNICO.includes(r));
}

/** Nivel 1 o 2 (o superadmin): puede operar trabajos de campo de otros. */
export function esNivel12(session: SessionClaims): boolean {
  return isLevel1(session) || isLevel2(session);
}

/**
 * Quién toca precios de mantenimiento, N incluidos y «pagado»: la oficina
 * (admin, director técnico y comercial). El director de telemarketing NO
 * (Mario 2026-11-13).
 */
export function esOficinaMant(session: SessionClaims): boolean {
  return (
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("commercial_director")
  );
}

/** Quién gestiona stock y almacenes (mover, ajustar, lotes, conteos, cargas). */
export function esGestorStock(session: SessionClaims): boolean {
  return (
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director")
  );
}

/**
 * Lanza si la sesión no puede operar un trabajo de campo (instalación o
 * mantenimiento) asignado a `asignadoA`. Nivel 1/2 opera cualquiera de su
 * empresa; el resto, solo los suyos.
 */
export function assertTrabajoAsignado(
  session: SessionClaims,
  asignadoA: string | null | undefined,
  que: "instalación" | "mantenimiento",
): void {
  if (esNivel12(session)) return;
  if (!asignadoA || asignadoA !== session.user_id) {
    throw new Error(`Este ${que === "instalación" ? "parte de instalación" : "mantenimiento"} no está asignado a ti`);
  }
}

/** Horas que el técnico sigue viendo al cliente tras cerrar el trabajo (D4). */
export const HORAS_TRAS_CIERRE = 24;

export type MotivoPendiente = {
  tipo: "instalacion" | "mantenimiento";
  id: string;
  fecha: string | null;
  estado: string;
};

/**
 * Clientes "pendientes" del técnico (regla D3 + D4): mantenimientos e
 * instalaciones asignados a él y no cerrados (sea cual sea la fecha), o
 * cerrados hace menos de 24 h. La agenda NO cuenta.
 *
 * Misma regla que la función SQL `app.cliente_pendiente_para_mi`. Lee con
 * admin filtrando SIEMPRE por company_id y por el propio usuario.
 * Devuelve customer_id → motivos (el más próximo primero).
 */
export async function listarClientesPendientes(
  session: SessionClaims,
  soloCliente?: string,
): Promise<Map<string, MotivoPendiente[]>> {
  const res = new Map<string, MotivoPendiente[]>();
  if (!session.company_id) return res;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const limite = new Date(Date.now() - HORAS_TRAS_CIERRE * 3600_000).toISOString();
  const vigente = `status.not.in.(completed,cancelled),completed_at.gt.${limite}`;

  const add = (cid: string | null, m: MotivoPendiente) => {
    if (!cid) return;
    const arr = res.get(cid) ?? [];
    arr.push(m);
    res.set(cid, arr);
  };

  type I = { id: string; customer_id: string | null; scheduled_at: string | null; status: string };
  type M = { id: string; customer_id: string | null; scheduled_at: string | null; status: string };

  const [inst, mant] = await Promise.all([
    fetchAllRows<I>((from, to) => {
      let q = admin
        .from("installations")
        .select("id, customer_id, scheduled_at, status")
        .eq("company_id", session.company_id)
        .eq("installer_user_id", session.user_id)
        .is("deleted_at", null)
        .or(vigente);
      if (soloCliente) q = q.eq("customer_id", soloCliente);
      return q.order("id").range(from, to);
    }).catch(() => [] as I[]),
    fetchAllRows<M>((from, to) => {
      let q = admin
        .from("maintenance_jobs")
        .select("id, customer_id, scheduled_at, status")
        .eq("company_id", session.company_id)
        .eq("technician_user_id", session.user_id)
        .or(vigente);
      if (soloCliente) q = q.eq("customer_id", soloCliente);
      return q.order("id").range(from, to);
    }).catch(() => [] as M[]),
  ]);
  for (const i of inst) {
    add(i.customer_id, { tipo: "instalacion", id: i.id, fecha: i.scheduled_at, estado: i.status });
  }
  for (const m of mant) {
    add(m.customer_id, { tipo: "mantenimiento", id: m.id, fecha: m.scheduled_at, estado: m.status });
  }
  for (const arr of res.values()) {
    arr.sort((a, b) => (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999"));
  }
  return res;
}

/** ¿Este cliente está pendiente para el técnico? (regla D3 + D4) */
export async function clientePendienteParaTecnico(
  session: SessionClaims,
  customerId: string,
): Promise<boolean> {
  if (!customerId) return false;
  const m = await listarClientesPendientes(session, customerId);
  return m.has(customerId);
}
