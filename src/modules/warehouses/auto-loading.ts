// Sin "use server" (auditoría 2026-10-01): solo la llama el cron. Como server
// action cualquiera podía dispararla desde el navegador.

import type { EmpresasEnServicio } from "@/shared/lib/empresas/en-servicio";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { notify } from "@/modules/notifications/notifier";
import { claveDiaMadrid, sumarDiasClave } from "@/modules/scheduling/fechas-madrid";
import {
  ESTADOS_ABIERTOS,
  calcularSugerencia,
  crearOrdenSugerida,
} from "./carga-sugerida-datos";
import { esTablaQueFalta } from "./filtros-carga";

/** Hora de Madrid a la que el cron horario prepara las sugerencias de la tarde. */
export const HORA_SUGERENCIA_TARDE = 16;

/**
 * Sugerencias de carga AUTOMÁTICAS de la tarde (Mario 2026-11-25).
 *
 * Antes (hasta 2026-11-25) esto generaba una orden por técnico con TODAS las
 * instalaciones de mañana, sin preguntar a nadie, y leía `companies` filtrando
 * por `deleted_at`, columna que no existe: la consulta fallaba en silencio y
 * en producción no se generó nunca ninguna orden (0 filas en loading_requests).
 *
 * Ahora la sugerencia se genera SI EL TÉCNICO LA PIDE: a mano desde «Mi
 * furgoneta» o, solo si lo ha activado y carga por la tarde, aquí. Para cada
 * técnico con `preferencias_carga_tecnico.sugerencia_auto` y momento 'tarde'
 * de una empresa EN SERVICIO:
 *  1. Calcula la carga de mañana (trabajos + reserva − lo que lleva).
 *  2. Si no hay nada que cargar o ya tiene una orden abierta para mañana, nada.
 *  3. Crea la orden «solicitada» (no mueve stock) y le avisa SOLO a él.
 * Sin avisos a la oficina: las órdenes salen en /almacenes como siempre.
 */
export async function generarSugerenciasDeLaTarde(
  enServicio: EmpresasEnServicio,
  ahora: Date = new Date(),
): Promise<{ tecnicos: number; creadas: number; errores: number; omitido?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { tecnicos: 0, creadas: 0, errores: 0 } as {
    tecnicos: number;
    creadas: number;
    errores: number;
    omitido?: string;
  };
  if (enServicio.ids.length === 0) return stats;

  const { data, error } = await admin
    .from("preferencias_carga_tecnico")
    .select("company_id, user_id")
    .eq("sugerencia_auto", true)
    .eq("momento", "tarde")
    .in("company_id", enServicio.ids)
    .limit(1000);
  if (error) {
    if (esTablaQueFalta(error)) return { ...stats, omitido: "Migración 20261128130000 sin aplicar" };
    throw new Error(error.message);
  }

  const dia = sumarDiasClave(claveDiaMadrid(ahora), 1);
  for (const p of (data ?? []) as Array<{ company_id: string; user_id: string }>) {
    if (!enServicio.has(p.company_id)) continue;
    stats.tecnicos += 1;
    try {
      const s = await calcularSugerencia(admin, p.company_id, p.user_id, dia);
      if ("error" in s || s.lineas.length === 0) continue;

      const { data: abiertas } = await admin
        .from("loading_requests")
        .select("id")
        .eq("company_id", p.company_id)
        .eq("destination_warehouse_id", s.furgoneta.id)
        .eq("needed_for", dia)
        .in("status", ESTADOS_ABIERTOS as unknown as string[])
        .limit(1);
      if (((abiertas ?? []) as unknown[]).length > 0) continue;

      const r = await crearOrdenSugerida(admin, {
        companyId: p.company_id,
        userId: null,
        furgonetaId: s.furgoneta.id,
        origenId: s.origen.id,
        dia,
        lineas: s.lineas.map((l) => ({ tipo: l.tipo, id: l.id, cantidad: l.aCargar })),
        automatica: true,
      });
      stats.creadas += 1;

      try {
        await notify({
          company_id: p.company_id,
          recipient_user_id: p.user_id,
          kind: "loading.suggested",
          severity: "info",
          title: "Tu carga para mañana",
          body: `${s.lineas.length} artículo(s) para cargar en la furgoneta. Revísala en Mi furgoneta.`,
          subject_type: "loading_request",
          subject_id: r.id,
          action_url: "/mi-furgoneta",
        });
      } catch {
        /* fail-soft */
      }
    } catch (e) {
      console.error("[generarSugerenciasDeLaTarde]", p.company_id, p.user_id, e);
      stats.errores += 1;
    }
  }
  return stats;
}
