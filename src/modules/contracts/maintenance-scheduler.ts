"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";

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
  // Admin client: esta función corre también en la firma REMOTA (sin sesión),
  // donde el cliente RLS bloquearía todas las escrituras y no se crearían los
  // mantenimientos. Todo lo que escribe deriva del propio contrato (company_id
  // de la fila cargada), así que es seguro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

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

  // Si solo hay un instalador/técnico activo en la empresa, autoasignar.
  let autoTechnicianId: string | null = null;
  const { data: techs } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("company_id", c.company_id)
    .in("role_key", ["installer", "technical_director"])
    .is("revoked_at", null);
  const uniqTechs = Array.from(
    new Set(((techs ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );
  if (uniqTechs.length === 1) autoTechnicianId = uniqTechs[0]!;

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
    technician_user_id: string | null;
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
      technician_user_id: autoTechnicianId,
    });
  }
  if (rows.length === 0) return 0;
  await supabase.from("maintenance_jobs").insert(rows);

  // Encolar avisos de email al cliente 3 días antes de cada mantenimiento
  // (cuando el usuario configure proveedor de email, se enviarán de la cola).
  try {
    const { data: customer } = await supabase
      .from("customers")
      .select("email, first_name, last_name, trade_name, legal_name, party_kind")
      .eq("id", c.customer_id)
      .maybeSingle();
    type CC = {
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      trade_name: string | null;
      legal_name: string | null;
      party_kind: "individual" | "company";
    };
    const cust = customer as CC | null;
    if (cust?.email) {
      const toName =
        cust.party_kind === "company"
          ? cust.trade_name || cust.legal_name || "Cliente"
          : `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim() || "Cliente";
      const reminders = rows.map((row) => {
        const d = new Date(row.scheduled_at);
        const sendAt = new Date(d.getTime() - 3 * 86400000);
        return {
          company_id: c.company_id,
          to_email: cust.email,
          to_name: toName,
          subject: "Recordatorio: mantenimiento programado",
          body_text: `Hola ${toName},\n\nLe recordamos que su próximo mantenimiento está programado para el ${d.toLocaleDateString("es-ES")}.\n\nUn saludo.`,
          kind: "maintenance_reminder",
          send_at: sendAt.toISOString(),
          subject_type: "contract",
          subject_id: c.id,
        };
      });
      await supabase.from("email_outbox").insert(reminders);
    }
  } catch {
    /* fail-soft */
  }

  return rows.length;
}
