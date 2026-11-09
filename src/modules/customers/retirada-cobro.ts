import "server-only";
import { errorMessage } from "@/shared/lib/actions/safe-error";
import { formatDateES } from "@/shared/lib/format-date";
import {
  ESTADOS_MANTENIMIENTO_NO_CANCELABLES,
  cancelarMantenimientosProgramadosContrato,
  marcarContratoCompletado,
} from "@/modules/contracts/finalizar-contrato-nucleo";
import {
  anadirNota,
  calcularReduccionCuota,
  decidirContrato,
  equiposRentingPuro,
  type EquipoContrato,
  type LineaContrato,
} from "./retirada-logica";

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
  /** Contratos que siguen con otros equipos y bajan la cuota (céntimos/mes). */
  cuotas_reducidas: Array<{ contrato: string; antes: number; despues: number }>;
  contratos_mantenimiento_cancelados: number;
  mantenimientos_cancelados: number;
  avisos: string[];
}

export const COBRO_VACIO: ResultadoDejarDeCobrar = {
  contratos_finalizados: [],
  contratos_mantenidos: [],
  cuotas_reducidas: [],
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
    cuotas_reducidas: [],
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
      // 'in_progress' no se toca: hay un técnico en ello ahora.
      .not("status", "in", ESTADOS_MANTENIMIENTO_NO_CANCELABLES);
    if (error) throw error;
    for (const j of (jobs ?? []) as Array<{ id: string; notes: string | null }>) {
      const { data: u, error: uErr } = await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled", notes: anadirNota(j.notes, nota) })
        .eq("id", j.id)
        .eq("company_id", companyId)
        .not("status", "in", ESTADOS_MANTENIMIENTO_NO_CANCELABLES)
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
      .select("id, status, plan_type, reference_code, source_equipment_id, monthly_cents")
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
      monthly_cents: number | null;
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
        // CADA EQUIPO VA VINCULADO A SU PROPIA CUOTA (Mario 2026-11-09): el
        // contrato sigue con los demás equipos, pero se deja de cobrar la
        // parte del retirado (su línea del contrato).
        r.contratos_mantenidos.push(ref);
        const red = await reducirCuotaContrato(admin, companyId, {
          contract_id: c.id,
          cuota_actual: c.monthly_cents ?? 0,
          installation_ids: idsInst,
          retirando: p.equipment_ids,
          installation_id: p.installation_id,
          referencia: p.referencia,
          actor_user_id: p.actor_user_id,
        });
        if (red.ok) {
          r.cuotas_reducidas.push({ contrato: ref, antes: c.monthly_cents ?? 0, despues: red.nueva });
          r.avisos.push(
            `El contrato ${ref} sigue con otros ${restantes} equipo(s): la cuota baja de ${fmtEur(c.monthly_cents ?? 0)} a ${fmtEur(red.nueva)} al mes.`,
          );
        } else {
          r.avisos.push(
            `El contrato ${ref} cubre otros ${restantes} equipo(s) activos y NO se ha podido rebajar la cuota (${red.motivo}): sigue cobrando la cuota completa, revísala a mano.`,
          );
        }
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
          `El contrato ${ref} tenía ${fmtEur(fianza)} de fianza cobrada: no se ha devuelto ni retenido. Puedes devolverla con «Reintegrar fianza» en la ficha del contrato.`,
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

/**
 * Rebaja la cuota de un contrato que sigue con otros equipos en lo que vale
 * (según su línea) el equipo retirado. Compare-and-set sobre monthly_cents:
 * si otro proceso la cambió a la vez, no se toca y se avisa.
 */
async function reducirCuotaContrato(
  admin: Admin,
  companyId: string,
  p: {
    contract_id: string;
    cuota_actual: number;
    installation_ids: string[];
    retirando: string[];
    installation_id: string;
    referencia: string;
    actor_user_id: string | null;
  },
): Promise<{ ok: true; nueva: number } | { ok: false; motivo: string }> {
  const { data: lineas, error: lErr } = await admin
    .from("contract_items")
    .select("product_id, quantity, unit_price_cents")
    .eq("contract_id", p.contract_id)
    .eq("company_id", companyId);
  if (lErr) return { ok: false, motivo: lErr.message };
  if (p.installation_ids.length === 0) return { ok: false, motivo: "contrato sin instalación" };
  const { data: eqs, error: eErr } = await admin
    .from("customer_equipment")
    .select("id, product_id, is_active")
    .eq("company_id", companyId)
    .in("installation_id", p.installation_ids);
  if (eErr) return { ok: false, motivo: eErr.message };
  const equipos = (eqs ?? []) as EquipoContrato[];
  const ids = new Set(equipos.map((e) => e.id));
  const calc = calcularReduccionCuota({
    cuota_actual: p.cuota_actual,
    lineas: (lineas ?? []) as LineaContrato[],
    equipos,
    retirando: p.retirando.filter((x) => ids.has(x)),
  });
  if (!calc.ok) return calc;
  if (calc.reduccion === 0) return { ok: true, nueva: p.cuota_actual };

  const { data: upd, error: uErr } = await admin
    .from("contracts")
    .update({ monthly_cents: calc.nueva })
    .eq("id", p.contract_id)
    .eq("company_id", companyId)
    .eq("monthly_cents", p.cuota_actual)
    .in("status", ["signed", "active"])
    .select("id");
  if (uErr) return { ok: false, motivo: uErr.message };
  if (((upd ?? []) as unknown[]).length === 0) {
    return { ok: false, motivo: "la cuota ha cambiado mientras tanto" };
  }
  const { error: evErr } = await admin.from("events").insert({
    company_id: companyId,
    subject_type: "contract",
    subject_id: p.contract_id,
    kind: "contract.monthly_reduced",
    payload: {
      antes_cents: p.cuota_actual,
      despues_cents: calc.nueva,
      reduccion_cents: calc.reduccion,
      motivo: `Equipo retirado (${p.referencia})`,
      installation_id: p.installation_id,
      equipment_ids: p.retirando,
    },
    actor_user_id: p.actor_user_id,
  });
  if (evErr) console.error("[reducirCuotaContrato] evento:", evErr.message);
  return { ok: true, nueva: calc.nueva };
}

/**
 * Equipos que están en RENTING (Mario 2026-11-09: no se pueden retirar). Lo
 * es si algún contrato enlazado (por su instalación o, en los heredados, por
 * source_equipment_id) es de renting y no está cancelado ni finalizado. Sin
 * contrato enlazado no es renting, diga lo que diga `acquisition_type`.
 * Lanza si no puede comprobarlo (mejor no retirar que retirar un renting).
 */
export async function equiposEnRenting(
  admin: Admin,
  companyId: string,
  equipmentIds: string[],
): Promise<string[]> {
  return (await rentingVivoDeEquipos(admin, companyId, equipmentIds)).equipos;
}

/**
 * Como `equiposEnRenting`, pero devuelve también los contratos de renting
 * vivos que los atan (para decir en el mensaje cuál lo impide).
 */
export async function rentingVivoDeEquipos(
  admin: Admin,
  companyId: string,
  equipmentIds: string[],
): Promise<{
  equipos: string[];
  contratos: Array<{ id: string; reference_code: string | null }>;
}> {
  if (equipmentIds.length === 0) return { equipos: [], contratos: [] };
  const { data: eqs, error: eErr } = await admin
    .from("customer_equipment")
    .select("id, installation_id, acquisition_type")
    .eq("company_id", companyId)
    .in("id", equipmentIds);
  if (eErr) throw new Error(`No se pudo comprobar el contrato del equipo: ${eErr.message}`);
  const lista = (eqs ?? []) as Array<{
    id: string;
    installation_id: string | null;
    acquisition_type: string | null;
  }>;
  const instIds = Array.from(
    new Set(lista.map((e) => e.installation_id).filter((x): x is string => !!x)),
  );
  const contratoDeInst = new Map<string, string>();
  if (instIds.length > 0) {
    const { data, error } = await admin
      .from("installations")
      .select("id, contract_id")
      .eq("company_id", companyId)
      .in("id", instIds);
    if (error) throw new Error(`No se pudo comprobar el contrato del equipo: ${error.message}`);
    for (const x of (data ?? []) as Array<{ id: string; contract_id: string | null }>) {
      if (x.contract_id) contratoDeInst.set(x.id, x.contract_id);
    }
  }
  type C = {
    id: string;
    plan_type: string;
    status: string;
    source_equipment_id: string | null;
    reference_code: string | null;
  };
  const contratos: C[] = [];
  const ids = Array.from(new Set(contratoDeInst.values()));
  if (ids.length > 0) {
    const { data, error } = await admin
      .from("contracts")
      .select("id, plan_type, status, source_equipment_id, reference_code")
      .eq("company_id", companyId)
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw new Error(`No se pudo comprobar el contrato del equipo: ${error.message}`);
    contratos.push(...((data ?? []) as C[]));
  }
  {
    const { data, error } = await admin
      .from("contracts")
      .select("id, plan_type, status, source_equipment_id, reference_code")
      .eq("company_id", companyId)
      .in("source_equipment_id", equipmentIds)
      .is("deleted_at", null);
    if (error) throw new Error(`No se pudo comprobar el contrato del equipo: ${error.message}`);
    contratos.push(...((data ?? []) as C[]));
  }
  const equipos = equiposRentingPuro(lista, contratoDeInst, contratos);
  const vistos = new Map<string, { id: string; reference_code: string | null }>();
  for (const c of contratos) {
    if (c.plan_type !== "renting" || c.status === "cancelled" || c.status === "completed") continue;
    const ata = lista.some(
      (e) =>
        equipos.includes(e.id) &&
        ((e.installation_id && contratoDeInst.get(e.installation_id) === c.id) ||
          c.source_equipment_id === e.id),
    );
    if (ata) vistos.set(c.id, { id: c.id, reference_code: c.reference_code });
  }
  return { equipos, contratos: Array.from(vistos.values()) };
}
