import "server-only";
import { errorMessage } from "@/shared/lib/actions/safe-error";
import { formatDateES } from "@/shared/lib/format-date";
import {
  cancelarMantenimientosProgramadosContrato,
  marcarContratoCompletado,
} from "@/modules/contracts/finalizar-contrato-nucleo";
import { anadirNota, decidirContrato } from "./retirada-logica";

/**
 * "Al retirar un equipo SE DEJA DE COBRAR" (decisión Mario 2026-11-09).
 * Se ejecuta desde `aplicarCierreRetirada`, es decir, en la retirada
 * agendada (cierre del técnico), en "ya está hecha" y en la manual.
 *
 *  1. Mantenimientos NO realizados del equipo → `cancelled`, con nota.
 *  2. Contratos de mantenimiento (`maintenance_contracts`) de ESE equipo →
 *     `cancelled` (la remesa mensual solo factura los `active`).
 *  3. Contrato de alquiler / renting del equipo → `completed` con el núcleo
 *     de `finalizeRentalContractAction` (el cron de cuotas solo factura los
 *     `active`). Solo si al contrato NO le queda ningún otro equipo activo;
 *     si le quedan, se deja cobrando y se avisa.
 * No toca facturas ni cobros ya emitidos, ni hace prorrateo, penalización
 * ni movimiento de fianza. Nunca lanza: los fallos vuelven como avisos.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface ResultadoDejarDeCobrar {
  contratos_finalizados: string[];
  contratos_mantenidos: string[];
  contratos_mantenimiento_cancelados: number;
  mantenimientos_cancelados: number;
  avisos: string[];
}

export const COBRO_VACIO: ResultadoDejarDeCobrar = {
  contratos_finalizados: [],
  contratos_mantenidos: [],
  contratos_mantenimiento_cancelados: 0,
  mantenimientos_cancelados: 0,
  avisos: [],
};

const fmtEur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;

export async function dejarDeCobrarEquipos(
  admin: Admin,
  companyId: string,
  p: {
    customer_id: string;
    equipment_ids: string[];
    installation_id: string;
    referencia: string;
    /** Instante ISO de la retirada. */
    fecha: string;
    motivo: string | null;
    actor_user_id: string | null;
  },
): Promise<ResultadoDejarDeCobrar> {
  const r: ResultadoDejarDeCobrar = {
    contratos_finalizados: [],
    contratos_mantenidos: [],
    contratos_mantenimiento_cancelados: 0,
    mantenimientos_cancelados: 0,
    avisos: [],
  };
  const fechaTxt = formatDateES(p.fecha);
  const motivoTxt = p.motivo ? ` Motivo: ${p.motivo}` : "";
  const nota = `Cancelado: equipo retirado (${p.referencia}, ${fechaTxt}).${motivoTxt}`;

  // ---- 1) Mantenimientos no realizados del equipo ----
  try {
    const { data: jobs, error } = await admin
      .from("maintenance_jobs")
      .select("id, notes")
      .eq("company_id", companyId)
      .in("customer_equipment_id", p.equipment_ids)
      .is("completed_at", null)
      // [decide] 'in_progress' no se toca: hay un técnico en ello ahora.
      .not("status", "in", "(completed,cancelled,in_progress)");
    if (error) throw error;
    for (const j of (jobs ?? []) as Array<{ id: string; notes: string | null }>) {
      const { data: u, error: uErr } = await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled", notes: anadirNota(j.notes, nota) })
        .eq("id", j.id)
        .eq("company_id", companyId)
        .not("status", "in", "(completed,cancelled,in_progress)")
        .select("id");
      if (uErr) throw uErr;
      r.mantenimientos_cancelados += ((u ?? []) as unknown[]).length;
    }
  } catch (e) {
    r.avisos.push(`No se pudieron cancelar los mantenimientos del equipo: ${errorMessage(e)}`);
  }

  // ---- 2) Contratos de mantenimiento del equipo ----
  try {
    const { data: mcs, error } = await admin
      .from("maintenance_contracts")
      .select("id, reference_code")
      .eq("company_id", companyId)
      .in("customer_equipment_id", p.equipment_ids)
      .in("status", ["draft", "active", "paused"])
      .is("deleted_at", null);
    if (error) throw error;
    for (const mc of (mcs ?? []) as Array<{ id: string; reference_code: string | null }>) {
      const { data: u, error: uErr } = await admin
        .from("maintenance_contracts")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_reason: nota,
        })
        .eq("id", mc.id)
        .eq("company_id", companyId)
        .in("status", ["draft", "active", "paused"])
        .select("id");
      if (uErr) throw uErr;
      if (((u ?? []) as unknown[]).length === 0) continue;
      r.contratos_mantenimiento_cancelados += 1;
      await admin.from("events").insert({
        company_id: companyId,
        subject_type: "maintenance_contract",
        subject_id: mc.id,
        kind: "maintenance_contract.cancelled",
        payload: { reason: nota, origen: "retirada", installation_id: p.installation_id },
        actor_user_id: p.actor_user_id,
      });
    }
    // Contratos de mantenimiento del cliente SIN equipo concreto: no sabemos
    // si cubren el equipo retirado → no se tocan, se avisa.
    const { count } = await admin
      .from("maintenance_contracts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("customer_id", p.customer_id)
      .is("customer_equipment_id", null)
      .eq("status", "active")
      .is("deleted_at", null);
    if ((count ?? 0) > 0) {
      r.avisos.push(
        `El cliente tiene ${count} contrato(s) de mantenimiento sin equipo asignado que siguen activos; revisa si hay que cancelarlos.`,
      );
    }
  } catch (e) {
    r.avisos.push(`No se pudieron revisar los contratos de mantenimiento: ${errorMessage(e)}`);
  }

  // ---- 3) Contrato con cuota (alquiler / renting) ----
  try {
    const { data: eqs, error: eErr } = await admin
      .from("customer_equipment")
      .select("id, installation_id")
      .eq("company_id", companyId)
      .in("id", p.equipment_ids);
    if (eErr) throw eErr;
    const instIds = Array.from(
      new Set(
        ((eqs ?? []) as Array<{ installation_id: string | null }>)
          .map((e) => e.installation_id)
          .filter((x): x is string => !!x),
      ),
    );
    const contratoIds = new Set<string>();
    if (instIds.length > 0) {
      const { data: insts, error } = await admin
        .from("installations")
        .select("contract_id")
        .eq("company_id", companyId)
        .in("id", instIds);
      if (error) throw error;
      for (const x of (insts ?? []) as Array<{ contract_id: string | null }>) {
        if (x.contract_id) contratoIds.add(x.contract_id);
      }
    }
    // Contratos heredados: 1 contrato por equipo (source_equipment_id).
    {
      const { data: leg, error } = await admin
        .from("contracts")
        .select("id")
        .eq("company_id", companyId)
        .in("source_equipment_id", p.equipment_ids);
      if (error) throw error;
      for (const x of (leg ?? []) as Array<{ id: string }>) contratoIds.add(x.id);
    }
    if (contratoIds.size === 0) return r;

    const { data: cts, error: cErr } = await admin
      .from("contracts")
      .select("id, status, plan_type, reference_code, source_equipment_id")
      .eq("company_id", companyId)
      .in("id", Array.from(contratoIds))
      .is("deleted_at", null);
    if (cErr) throw cErr;

    for (const c of (cts ?? []) as Array<{
      id: string;
      status: string;
      plan_type: string;
      reference_code: string | null;
      source_equipment_id: string | null;
    }>) {
      // Solo contratos que cobran cuota y siguen vivos. Contado: el equipo
      // es del cliente, no hay cuota que parar.
      if (c.plan_type !== "rental" && c.plan_type !== "renting") continue;
      if (c.status !== "signed" && c.status !== "active") continue;
      const ref = c.reference_code ?? c.id.slice(0, 8);

      // ¿Le quedan otros equipos activos?
      const { data: instDeC, error: iErr } = await admin
        .from("installations")
        .select("id")
        .eq("company_id", companyId)
        .eq("contract_id", c.id);
      if (iErr) throw iErr;
      const idsInst = ((instDeC ?? []) as Array<{ id: string }>).map((x) => x.id);
      let restantes = 0;
      if (idsInst.length > 0) {
        const { count, error } = await admin
          .from("customer_equipment")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true)
          .in("installation_id", idsInst);
        if (error) throw error;
        restantes += count ?? 0;
      }
      if (c.source_equipment_id && !p.equipment_ids.includes(c.source_equipment_id)) {
        const { count, error } = await admin
          .from("customer_equipment")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true)
          .eq("id", c.source_equipment_id);
        if (error) throw error;
        restantes += count ?? 0;
      }

      if (decidirContrato(restantes) === "mantener") {
        r.contratos_mantenidos.push(ref);
        r.avisos.push(
          `El contrato ${ref} cubre otros ${restantes} equipo(s) activos: NO se ha finalizado y sigue cobrando la cuota completa.`,
        );
        continue;
      }

      const { cerrado } = await marcarContratoCompletado(admin, companyId, c.id);
      if (!cerrado) continue; // otro proceso lo cerró a la vez
      r.contratos_finalizados.push(ref);
      await cancelarMantenimientosProgramadosContrato(admin, companyId, c.id);

      // Fianza: no se devuelve ni se retiene aquí (es decisión del cierre
      // manual del alquiler). Se avisa para que no se quede olvidada.
      const { data: deps } = await admin
        .from("contract_payments")
        .select("amount_cents, status")
        .eq("contract_id", c.id)
        .eq("company_id", companyId)
        .ilike("concept", "Fianza%");
      const fianza = ((deps ?? []) as Array<{ amount_cents: number; status: string }>)
        .filter((d) => d.status === "validated" || d.status === "collected_pending_validation")
        .reduce((s, d) => s + d.amount_cents, 0);
      if (fianza > 0) {
        r.avisos.push(
          `El contrato ${ref} tenía ${fmtEur(fianza)} de fianza cobrada: no se ha devuelto ni retenido; regístralo aparte.`,
        );
      }

      // Cobros generados DESPUÉS de la fecha de retirada: no se tocan.
      const { count: posteriores } = await admin
        .from("contract_payments")
        .select("id", { count: "exact", head: true })
        .eq("contract_id", c.id)
        .eq("company_id", companyId)
        .gt("created_at", p.fecha)
        .gt("amount_cents", 0)
        .not("concept", "ilike", "Fianza%");
      if ((posteriores ?? 0) > 0) {
        r.avisos.push(
          `El contrato ${ref} tiene ${posteriores} cobro(s) generados después de la fecha de retirada; no se han tocado, revísalos.`,
        );
      }

      const { error: evErr } = await admin.from("events").insert({
        company_id: companyId,
        subject_type: "contract",
        subject_id: c.id,
        kind: "contract.rental_finalized",
        payload: {
          reason: `Equipo retirado (${p.referencia}).${motivoTxt}`.trim(),
          deposit_action: "none",
          deposit_total_cents: fianza,
          origen: "retirada",
          installation_id: p.installation_id,
          fecha_retirada: p.fecha,
        },
        actor_user_id: p.actor_user_id,
      });
      if (evErr) console.error("[dejarDeCobrar] evento contrato:", evErr.message);
    }
  } catch (e) {
    r.avisos.push(`No se pudo revisar el contrato del equipo: ${errorMessage(e)}`);
  }

  return r;
}
