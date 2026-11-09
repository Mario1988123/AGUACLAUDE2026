"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { madridDateKey, madridLocalToUtcISO } from "@/shared/lib/format-date";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { scheduleFreeTrialUninstallAction } from "@/modules/free-trials/uninstall-actions";
import {
  ESTADO_EQUIPO_LABEL,
  MARCA_RETIRADA_MANUAL,
  instanteRetirada,
  pruebaRetirable,
  puedeRetirar,
  validarRetiradaPrueba,
  type EntradaRetiradaPrueba,
  type OrdenAbierta,
} from "./retirada-logica";
import { cerrarOrdenRetirada, marcarLineasParaRevisar } from "./retirada-nucleo";
import type { ResultadoRetiradaManual } from "./retirada-manual-actions";

/**
 * RETIRADA MANUAL de una PRUEBA GRATUITA (decisión Mario 2026-11-09: para la
 * retirada manual se revoca la regla del 2026-05-12 de pasar siempre por una
 * desinstalación agendada).
 *
 * Mismo camino que la agendada: crea la orden con
 * `scheduleFreeTrialUninstallAction` y la cierra con el núcleo común, que
 * devuelve el stock y pasa la prueba a `removed`
 * (processFreeTrialUninstallCompletion). Las órdenes de retirada abiertas de
 * la prueba se cancelan antes, para que no devuelvan el stock otra vez.
 * Una segunda llamada encuentra la prueba en `removed` y no hace nada.
 */
export async function retirarPruebaManualAction(
  entrada: EntradaRetiradaPrueba,
): Promise<({ ok: true } & ResultadoRetiradaManual) | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeRetirar(session)) {
      return { ok: false, error: "Solo el administrador o el director técnico pueden retirar equipos" };
    }
    const companyId = session.company_id;
    const ahora = new Date();
    const hoy = madridDateKey(ahora);
    const v = validarRetiradaPrueba(entrada, hoy);
    if (!v.ok) return v;
    const d = v.datos;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: trial, error: tErr } = await admin
      .from("free_trials")
      .select("id, status")
      .eq("id", d.trial_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (tErr) return { ok: false, error: tErr.message };
    const t = trial as { id: string; status: string } | null;
    if (!t) return { ok: false, error: "Prueba no encontrada" };
    if (t.status === "removed") return { ok: false, error: "Esta prueba ya está retirada" };
    if (!pruebaRetirable(t.status)) {
      return {
        ok: false,
        error: `No se puede retirar una prueba en estado "${t.status}": el equipo no está en casa del cliente`,
      };
    }

    // Órdenes de retirada abiertas de la prueba → se cancelan (la manual las
    // sustituye).
    const { data: abiertas, error: oErr } = await admin
      .from("installations")
      .select("id, reference_code, notes")
      .eq("company_id", companyId)
      .eq("free_trial_id", d.trial_id)
      .eq("kind", "uninstall")
      .not("status", "in", "(completed,cancelled)")
      .is("deleted_at", null);
    if (oErr) return { ok: false, error: oErr.message };

    const nombreActor = session.full_name ?? session.email ?? session.user_id;
    const instante = instanteRetirada(d.fecha_retirada, hoy, ahora, madridLocalToUtcISO);
    const canceladas: string[] = [];
    for (const o of (abiertas ?? []) as OrdenAbierta[]) {
      const { data: c, error: kErr } = await admin
        .from("installations")
        .update({
          status: "cancelled",
          notes: `${(o.notes ?? "").trim()}\n---\nCancelada: sustituida por una retirada manual (${d.fecha_retirada}).`,
        })
        .eq("id", o.id)
        .eq("company_id", companyId)
        .not("status", "in", "(completed,cancelled)")
        .select("id");
      if (kErr) return { ok: false, error: `No se pudo cancelar la retirada programada: ${kErr.message}` };
      if ((c ?? []).length > 0) canceladas.push(o.reference_code ?? o.id);
    }

    // Orden de retirada (mismo creador que la agendada).
    const creada = await scheduleFreeTrialUninstallAction({
      trial_id: d.trial_id,
      destination_warehouse_id: d.destination_warehouse_id,
      scheduled_at: instante,
      default_state: d.estado_vuelta,
      notes: [
        MARCA_RETIRADA_MANUAL,
        `Fecha de retirada: ${d.fecha_retirada}`,
        `Estado del equipo: ${ESTADO_EQUIPO_LABEL[d.estado_equipo]}`,
        `Motivo: ${d.motivo}`,
        `Registrada por: ${nombreActor}`,
      ].join("\n"),
    });
    if (!creada.ok) return { ok: false, error: creada.error };
    const instId = creada.installation_id;

    const anular = async () => {
      const { error } = await admin
        .from("installations")
        .update({ status: "cancelled", deleted_at: new Date().toISOString() })
        .eq("id", instId)
        .eq("company_id", companyId)
        .neq("status", "completed");
      if (error) console.error("[retirarPruebaManual] anular:", error.message);
    };

    // Sin líneas no vuelve el stock: el creador solo lo registra en el log;
    // aquí se comprueba y, si faltan, no se hace nada.
    const [itemsOrden, itemsPrueba] = await Promise.all([
      admin
        .from("installation_items")
        .select("id", { count: "exact", head: true })
        .eq("installation_id", instId),
      admin
        .from("free_trial_items")
        .select("id", { count: "exact", head: true })
        .eq("free_trial_id", d.trial_id),
    ]);
    if (itemsOrden.error || itemsPrueba.error || (itemsOrden.count ?? 0) < (itemsPrueba.count ?? 0)) {
      await anular();
      return { ok: false, error: "No se pudieron guardar las líneas de la retirada; no se ha hecho nada" };
    }
    if (d.nota_estado) await marcarLineasParaRevisar(admin, instId, d.nota_estado);

    const cierre = await cerrarOrdenRetirada(admin, companyId, instId, {
      completed_at: instante,
      actor_user_id: session.user_id,
      motivo: d.motivo,
    });
    if (!cierre.ok) {
      await anular();
      return { ok: false, error: cierre.error };
    }

    // El cierre pone la prueba en 'removed' con la hora actual; se ajusta a
    // la fecha real de la retirada.
    const { error: rErr } = await admin
      .from("free_trials")
      .update({ removed_at: instante })
      .eq("id", d.trial_id)
      .eq("company_id", companyId)
      .eq("status", "removed");
    if (rErr) console.error("[retirarPruebaManual] removed_at:", rErr.message);

    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "free_trial",
      subject_id: d.trial_id,
      kind: "free_trial.manual_uninstall",
      payload: {
        modo: "retirada manual (sin agendar)",
        installation_id: instId,
        reference_code: creada.reference_code,
        fecha_retirada: d.fecha_retirada,
        motivo: d.motivo,
        destination_warehouse_id: d.destination_warehouse_id,
        estado_equipo: d.estado_equipo,
        estado_vuelta: d.estado_vuelta,
        stock_devuelto: cierre.moved,
        ordenes_canceladas: canceladas,
        registrada_por: nombreActor,
      },
      actor_user_id: session.user_id,
    });
    if (evErr) console.error("[retirarPruebaManual] evento:", evErr.message);

    revalidatePath(`/pruebas-gratuitas/${d.trial_id}`);
    revalidatePath("/pruebas-gratuitas");
    revalidatePath("/instalaciones");
    revalidatePath(`/almacenes/${d.destination_warehouse_id}`);
    return {
      ok: true,
      installation_id: instId,
      reference_code: creada.reference_code,
      ordenes_canceladas: canceladas,
      contratos_finalizados: cierre.contratos_finalizados,
      contratos_mantenidos: cierre.contratos_mantenidos,
      cuotas_reducidas: cierre.cuotas_reducidas,
      mantenimientos_cancelados: cierre.mantenimientos_cancelados,
      contratos_mantenimiento_cancelados: cierre.contratos_mantenimiento_cancelados,
      avisos: cierre.avisos,
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
