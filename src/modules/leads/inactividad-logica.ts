/**
 * Lógica pura del aviso de leads inactivos y del dueño del cliente al
 * convertir un lead (plan docs/PLAN_REVISION_LEADS.md, decisiones del 12-11).
 *
 * Sin E/S: se prueba en inactividad-logica.test.ts.
 */

/** Días sin actividad antes de avisar si la empresa no tiene configuración. */
export const DIAS_INACTIVIDAD_POR_DEFECTO = 40;

/** Cada cuántos días se repite el aviso del mismo lead / el resumen al admin. */
export const DIAS_ENTRE_AVISOS = 7;

/** Estados de un lead que sigue abierto (los que salen en /leads). */
export const ESTADOS_LEAD_ABIERTO = [
  "new",
  "contacted",
  "free_trial_proposed",
  "proposal_created",
  "proposal_sent",
] as const;

/** Roles a los que se puede repartir un lead o que heredan un cliente. */
export const ROLES_CON_LEADS = [
  "sales_rep",
  "telemarketer",
  "commercial_director",
  "telemarketing_director",
] as const;

/**
 * Días de inactividad configurados. Lee `lead_stale_days` de la fila de
 * company_settings si existe (la columna llega con la migración
 * 20261113100000_leads_aviso_inactividad.sql); si no está o es absurda, 40.
 */
export function diasInactividad(settings: Record<string, unknown> | null | undefined): number {
  const v = Number(settings?.lead_stale_days);
  if (Number.isInteger(v) && v >= 1 && v <= 365) return v;
  return DIAS_INACTIVIDAD_POR_DEFECTO;
}

export interface LeadParaAviso {
  id: string;
  created_at: string;
  assigned_at: string | null;
  updated_at: string | null;
}

/**
 * Fecha más reciente que el propio lead conoce (alta, asignación, última
 * edición). La actividad externa (eventos, agenda, pruebas) se mira aparte.
 */
export function fechaBaseLead(l: LeadParaAviso): number {
  return Math.max(
    Date.parse(l.created_at) || 0,
    l.assigned_at ? Date.parse(l.assigned_at) || 0 : 0,
    l.updated_at ? Date.parse(l.updated_at) || 0 : 0,
  );
}

/**
 * Leads que llevan `dias` sin actividad: su fecha base es anterior al corte
 * y no aparecen en `conActividad` (eventos recientes, agenda reciente o
 * futura, prueba gratuita abierta).
 */
export function leadsInactivos<T extends LeadParaAviso>(
  leads: T[],
  dias: number,
  conActividad: Set<string>,
  ahora: number = Date.now(),
): T[] {
  const corte = ahora - dias * 86_400_000;
  return leads.filter((l) => fechaBaseLead(l) < corte && !conActividad.has(l.id));
}

/**
 * Dueño del cliente que nace de un lead. Regla de Mario (12-11): el cliente
 * es de quien trabajó el lead, nunca del admin que lo convierte.
 *   1. el comercial asignado al lead;
 *   2. si no tiene, el último comercial que lo tuvo (evento
 *      lead.unassigned_by_expiry), si sigue activo con rol comercial;
 *   3. si no, quien creó el lead, si es comercial activo;
 *   4. si no, quien convierte (el cliente nunca queda sin dueño).
 */
export function elegirDuenoCliente(input: {
  asignado: string | null;
  ultimoDueno: string | null;
  creador: string | null;
  convierte: string;
  esComercialActivo: (userId: string) => boolean;
}): string {
  if (input.asignado) return input.asignado;
  if (input.ultimoDueno && input.esComercialActivo(input.ultimoDueno)) return input.ultimoDueno;
  if (input.creador && input.esComercialActivo(input.creador)) return input.creador;
  return input.convierte;
}

/**
 * Al reasignar un lead ya convertido, el cliente le sigue SOLO si su dueño
 * actual es el dueño anterior del lead (no pisa una reasignación hecha a
 * propósito en la ficha del cliente). Desasignar (nuevo null) no lo toca:
 * un cliente nunca queda sin dueño.
 */
export function clienteDebeSeguirAlLead(input: {
  duenoCliente: string | null;
  duenoAnteriorLead: string | null;
  duenoNuevoLead: string | null;
}): boolean {
  if (!input.duenoNuevoLead) return false;
  if (input.duenoCliente === input.duenoNuevoLead) return false;
  return !!input.duenoAnteriorLead && input.duenoCliente === input.duenoAnteriorLead;
}
