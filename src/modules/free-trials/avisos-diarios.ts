/**
 * Avisos diarios de pruebas gratuitas (Mario 2026-11-26). Los lanza el cron
 * horario una vez al día, a las 9:00 de Madrid, para que el push no llegue de
 * noche. Ninguna prueba se queda en un estado sin que nadie se entere:
 *
 *  - instalada, quedan 2 días      → al comercial: «quedan 2 días»;
 *  - instalada, hoy es el último   → al comercial: «llama y decide»;
 *  - terminada sin decidir         → cada día al comercial y al admin;
 *  - agendada con la fecha pasada  → cada día al admin y al director técnico;
 *  - se la quedó y el contrato lleva más de 2 días sin firmar → cada día al
 *    comercial del contrato.
 *
 * El comercial es el dueño del lead; si no hay, quien creó la prueba.
 * Helper de SERVIDOR con admin client.
 */
import { diasRestantesPrueba, fechaMadrid } from "@/modules/leads/prueba-lead";
import { nombreDePrueba } from "./instalacion-prueba";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Hora de Madrid a la que salen (la comprueba el cron). */
export const HORA_AVISOS_PRUEBAS = 9;

interface FilaPrueba {
  id: string;
  company_id: string;
  reference_code: string | null;
  status: string;
  installed_at: string | null;
  duration_days: number | null;
  scheduled_at: string | null;
  lead_id: string | null;
  customer_id: string | null;
  created_by: string | null;
}

export async function avisosDiariosPruebas(
  admin: Admin,
  empresas: string[],
): Promise<Record<string, number>> {
  const cuenta = {
    quedan_2: 0,
    ultimo_dia: 0,
    sin_decidir: 0,
    agendada_sin_hacer: 0,
    contrato_sin_firmar: 0,
  };
  if (empresas.length === 0) return cuenta;

  // Empresas con el módulo de pruebas apagado: nada.
  const { data: apagadas } = await admin
    .from("company_modules")
    .select("company_id")
    .eq("module_key", "free_trials")
    .eq("is_active", false);
  const off = new Set(((apagadas ?? []) as Array<{ company_id: string }>).map((r) => r.company_id));

  const { data } = await admin
    .from("free_trials")
    .select(
      "id, company_id, reference_code, status, installed_at, duration_days, scheduled_at, lead_id, customer_id, created_by",
    )
    .in("company_id", empresas)
    .in("status", ["installed", "expired", "scheduled"])
    .is("deleted_at", null)
    .limit(1000);
  const pruebas = ((data ?? []) as FilaPrueba[]).filter((p) => !off.has(p.company_id));
  const { notify, notifyByRoles } = await import("@/modules/notifications/notifier");

  // Contratos salidos de una prueba («se la queda») que nadie firma.
  try {
    const hace2 = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { data: borradores } = await admin
      .from("contracts")
      .select("id, company_id, reference_code, assigned_user_id, created_by, customer_snapshot")
      .in("company_id", empresas)
      .in("status", ["draft", "pending_data", "pending_signature"])
      .not("source_free_trial_id", "is", null)
      .is("deleted_at", null)
      .lt("created_at", hace2)
      .limit(500);
    for (const c of (borradores ?? []) as Array<{
      id: string;
      company_id: string;
      reference_code: string | null;
      assigned_user_id: string | null;
      created_by: string | null;
      customer_snapshot: Record<string, string | null> | null;
    }>) {
      if (off.has(c.company_id)) continue;
      const quien = c.assigned_user_id ?? c.created_by;
      if (!quien) continue;
      const cs = c.customer_snapshot ?? {};
      const nombre =
        cs.trade_name || cs.legal_name || `${cs.first_name ?? ""} ${cs.last_name ?? ""}`.trim() || "el cliente";
      await notify({
        company_id: c.company_id,
        recipient_user_id: quien,
        kind: "contract.unsigned_from_trial",
        category: "alert",
        severity: "warning",
        title: `Contrato sin firmar · ${nombre}`,
        body: `Se quedó la prueba, pero el contrato${c.reference_code ? ` ${c.reference_code}` : ""} sigue sin firmar. Cobra y firma, o cancélalo si se echa atrás.`,
        subject_type: "contract",
        subject_id: c.id,
        action_url: `/contratos/${c.id}`,
      });
      cuenta.contrato_sin_firmar++;
    }
  } catch (e) {
    console.error("[avisosDiariosPruebas] contratos sin firmar:", e);
  }
  if (pruebas.length === 0) return cuenta;
  const hoy = fechaMadrid(new Date());

  // Dueño de cada lead (el comercial que lleva al cliente).
  const leadIds = Array.from(new Set(pruebas.map((p) => p.lead_id).filter((v): v is string => !!v)));
  const duenoLead = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await admin
      .from("leads")
      .select("id, assigned_user_id")
      .in("id", leadIds);
    for (const l of (leads ?? []) as Array<{ id: string; assigned_user_id: string | null }>) {
      if (l.assigned_user_id) duenoLead.set(l.id, l.assigned_user_id);
    }
  }

  for (const p of pruebas) {
    try {
      const comercial = (p.lead_id && duenoLead.get(p.lead_id)) || p.created_by;
      const nombre = (await nombreDePrueba(admin, p.company_id, p)) ?? "el cliente";
      const ref = p.reference_code ? ` (${p.reference_code})` : "";
      const url = `/pruebas-gratuitas/${p.id}`;
      const base = {
        category: "alert" as const,
        subject_type: "free_trial" as const,
        subject_id: p.id,
        action_url: url,
      };

      if (p.status === "installed") {
        const dias = diasRestantesPrueba(p.installed_at, p.duration_days);
        if (dias === 2 && comercial) {
          await notify({
            ...base,
            company_id: p.company_id,
            recipient_user_id: comercial,
            kind: "free_trial.ending_soon",
            severity: "info",
            title: `Quedan 2 días de prueba · ${nombre}`,
            body: `La prueba gratuita${ref} termina en 2 días. Ve preparando la llamada.`,
          });
          cuenta.quedan_2++;
        } else if (dias === 0 && comercial) {
          await notify({
            ...base,
            company_id: p.company_id,
            recipient_user_id: comercial,
            kind: "free_trial.last_day",
            severity: "warning",
            title: `Hoy termina la prueba · ${nombre}`,
            body: `Llama al cliente y decide${ref}: se la queda (alquiler o compra) o se retira.`,
          });
          cuenta.ultimo_dia++;
        }
        continue;
      }

      if (p.status === "expired") {
        const aviso = {
          ...base,
          kind: "free_trial.pending_decision",
          severity: "warning" as const,
          title: `Prueba terminada sin decidir · ${nombre}`,
          body: `El equipo sigue en casa del cliente${ref}. Hay que decidir: se la queda o se retira.`,
        };
        if (comercial) {
          await notify({ ...aviso, company_id: p.company_id, recipient_user_id: comercial });
        }
        await notifyByRoles(p.company_id, ["company_admin"], aviso);
        cuenta.sin_decidir++;
        continue;
      }

      // Agendada y la fecha ya pasó (antes de hoy) sin instalar.
      if (p.status === "scheduled" && p.scheduled_at && fechaMadrid(p.scheduled_at) < hoy) {
        await notifyByRoles(p.company_id, ["company_admin", "technical_director"], {
          ...base,
          kind: "free_trial.install_overdue",
          severity: "warning",
          title: `Instalación de prueba sin hacer · ${nombre}`,
          body: `Estaba agendada el ${fechaMadrid(p.scheduled_at).split("-").reverse().join("/")}${ref} y no consta instalada. Reagéndala o márcala instalada.`,
        });
        cuenta.agendada_sin_hacer++;
      }
    } catch (e) {
      console.error("[avisosDiariosPruebas]", p.id, e);
    }
  }
  return cuenta;
}
