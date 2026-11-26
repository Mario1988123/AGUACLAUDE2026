/**
 * Contratos que salen de una prueba gratuita en la que el cliente se queda
 * el equipo ya instalado («se queda» o «reinstalar», Mario 2026-11-26).
 *
 * Ese equipo ya está en casa del cliente, así que al firmar:
 *  - NO se reserva stock (la reserva solo se liberaba al completar una
 *    instalación normal, que aquí no hay: quedaba una reserva fantasma);
 *  - el contrato pasa a ACTIVO con inicio de servicio el día de la firma
 *    (antes se quedaba en «firmado» para siempre: sin cuotas, sin
 *    mantenimientos y sin fecha de inicio).
 *
 * Si cambió de equipo no aplica: al firmar se crea la instalación normal del
 * nuevo y todo sigue el camino de siempre.
 *
 * Helpers de SERVIDOR con admin client; quien llama ya ha validado el contrato.
 */
import { fechaMadrid } from "@/modules/leads/prueba-lead";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** ¿El contrato lleva enlazada la instalación ya hecha de una prueba? */
export async function equipoDePruebaYaInstalado(
  admin: Admin,
  companyId: string,
  contractId: string,
): Promise<boolean> {
  const { count } = await admin
    .from("installations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("contract_id", contractId)
    .eq("kind", "free_trial")
    .eq("status", "completed")
    .is("deleted_at", null);
  return (count ?? 0) > 0;
}

/**
 * Activa el contrato recién firmado si su equipo es el de la prueba (ya
 * instalado). Idempotente: solo toca contratos en «firmado».
 */
export async function activarContratoDePrueba(
  admin: Admin,
  companyId: string,
  contractId: string,
  actorId: string | null,
): Promise<boolean> {
  try {
    if (!(await equipoDePruebaYaInstalado(admin, companyId, contractId))) return false;
    const hoy = fechaMadrid(new Date());
    const { data } = await admin
      .from("contracts")
      .update({ status: "active", service_start_date: hoy })
      .eq("id", contractId)
      .eq("company_id", companyId)
      .eq("status", "signed")
      .select("id");
    if (!data?.length) return false;
    let mantenimientos = 0;
    try {
      const { autoScheduleMaintenanceForContract } = await import(
        "@/modules/maintenance/auto-schedule"
      );
      mantenimientos = (await autoScheduleMaintenanceForContract(contractId)) ?? 0;
    } catch (e) {
      console.error("[contratoDePrueba] mantenimientos:", e);
    }
    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: contractId,
      kind: "contract.activated",
      payload: {
        motivo: "equipo de prueba gratuita ya instalado",
        service_start_date: hoy,
        maintenance_jobs_scheduled: mantenimientos,
      },
      actor_user_id: actorId,
    });
    return true;
  } catch (e) {
    console.error("[contratoDePrueba] activar:", e);
    return false;
  }
}
