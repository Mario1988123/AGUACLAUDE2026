import { createAdminClient } from "@/shared/lib/supabase/admin";
import { ensureMaintenanceWindow } from "@/modules/maintenance/auto-schedule";

/**
 * Programa los mantenimientos de un contrato al FIRMARLO (lo llaman
 * `contracts/actions.ts` y `post-sign.ts`).
 *
 * Auditoría 2026-10-01, I1: antes insertaba `kind: "preventive"`, que no
 * existe en el enum `maintenance_kind` (contracted, one_off, warranty). El
 * insert fallaba sin comprobar el error, la función devolvía como si hubiera
 * creado las visitas y además encolaba correos de recordatorio de visitas que
 * no existían (los 2 `maintenance_reminder` fallidos de `email_outbox`).
 *
 * Ahora delega en `ensureMaintenanceWindow`, la única fuente de verdad del
 * calendario de visitas (la que usan la instalación y el cron diario), con su
 * regla de cobertura, su deduplicación y estado `preprogrammed` para que el
 * admin confirme fecha y hora con el cliente.
 *
 * [decide] Si el contrato aún no tiene `service_start_date` (lo normal al
 * firmar: se fija al instalar), no se programa nada todavía. Programar desde
 * la fecha de firma y volver a programar desde la de servicio al instalar
 * creaba dos series desplazadas para el mismo contrato. Se programa al cerrar
 * la instalación (`autoScheduleMaintenanceForContract`) y el cron diario
 * mantiene la ventana de 12 meses.
 *
 * [decide] Ya no encola recordatorios en `email_outbox`: las visitas nacen
 * sin confirmar, y el aviso al cliente lo manda el cron
 * `maintenance-reminders` cuando la visita está agendada.
 *
 * Sin "use server": es una función interna de servidor. Exportarla como
 * server action la dejaba invocable desde el navegador con cualquier id.
 */
export async function scheduleMaintenanceForContract(
  contractId: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: contract, error } = await admin
    .from("contracts")
    .select("id, maintenance_included, maintenance_periodicity_months, service_start_date")
    .eq("id", contractId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el contrato: ${error.message}`);
  const c = contract as {
    id: string;
    maintenance_included: boolean | null;
    maintenance_periodicity_months: number | null;
    service_start_date: string | null;
  } | null;
  if (!c || !c.maintenance_included) return 0;
  if (!c.maintenance_periodicity_months || c.maintenance_periodicity_months <= 0) return 0;
  if (!c.service_start_date) return 0;
  return ensureMaintenanceWindow(c.id, 12);
}
