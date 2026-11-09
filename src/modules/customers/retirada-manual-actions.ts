"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { madridDateKey, madridLocalToUtcISO } from "@/shared/lib/format-date";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  ESTADO_EQUIPO_LABEL,
  MARCA_RETIRADA_MANUAL,
  clasificarOrdenesAbiertas,
  instanteRetirada,
  necesitaAlmacen,
  puedeRetirar,
  validarRetiradaManual,
  type EntradaRetiradaManual,
  type OrdenAbierta,
} from "./retirada-logica";
import {
  cerrarOrdenRetirada,
  crearOrdenRetirada,
  marcarLineasParaRevisar,
} from "./retirada-nucleo";

/** Resultado que ve el usuario tras una retirada manual (cliente o prueba). */
export type ResultadoRetiradaManual = {
  installation_id: string;
  reference_code: string;
  ordenes_canceladas: string[];
  contratos_finalizados: string[];
  contratos_mantenidos: string[];
  mantenimientos_cancelados: number;
  contratos_mantenimiento_cancelados: number;
  avisos: string[];
};

/**
 * RETIRADA MANUAL (sin agendar): deja reflejado en el CRM que un equipo ya
 * no está en el cliente (se retiró en la realidad, lo devolvió en tienda…)
 * sin pasar por tarea, técnico, cita ni parte.
 *
 * Produce EXACTAMENTE los mismos efectos que una orden de desinstalación
 * completada por el flujo normal, porque usa el mismo núcleo:
 *   1. crea la orden kind='uninstall' (crearOrdenRetirada),
 *   2. la cierra con compare-and-set y aplica el cierre común
 *      (aplicarCierreRetirada: stock vía adjust_stock_batch + baja de equipos).
 * Además cancela las órdenes de retirada abiertas que cubría y deja un evento
 * `equipment.manual_uninstall` con quién, cuándo, motivo y modo.
 *
 * Idempotente: los equipos se "reservan" (is_active true → false con
 * compare-and-set) antes de crear nada; un segundo envío, o dos a la vez,
 * encuentra el equipo ya dado de baja y no devuelve el stock otra vez.
 */
export async function retirarEquipoManualAction(
  entrada: EntradaRetiradaManual,
): Promise<
  | ({ ok: true } & ResultadoRetiradaManual)
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!puedeRetirar(session)) {
      return { ok: false, error: "Solo el administrador o el director técnico pueden retirar equipos" };
    }
    const companyId = session.company_id;
    const ahora = new Date();
    const hoy = madridDateKey(ahora);
    const v = validarRetiradaManual(entrada, hoy);
    if (!v.ok) return v;
    const d = v.datos;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Cliente y equipos de TU empresa (admin salta RLS → filtro explícito).
    const { data: cust, error: cErr } = await admin
      .from("customers")
      .select("id")
      .eq("id", d.customer_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (cErr) return { ok: false, error: cErr.message };
    if (!cust) return { ok: false, error: "Cliente no encontrado" };

    const { data: eqRows, error: eErr } = await admin
      .from("customer_equipment")
      .select("id, product_id, is_active")
      .in("id", d.equipment_ids)
      .eq("company_id", companyId)
      .eq("customer_id", d.customer_id);
    if (eErr) return { ok: false, error: eErr.message };
    const equipos = (eqRows ?? []) as Array<{ id: string; product_id: string | null; is_active: boolean }>;
    if (equipos.length !== d.equipment_ids.length) {
      return { ok: false, error: "Algún equipo no es de este cliente" };
    }
    if (equipos.some((e) => !e.is_active)) {
      return { ok: false, error: "Algún equipo ya estaba retirado. Recarga la ficha." };
    }

    // 2) Almacén: mismo criterio que la orden normal (solo si algún equipo
    //    nuestro vuelve a almacén). La pertenencia se verifica en el núcleo.
    const hayStock = necesitaAlmacen(equipos, d.destinos);
    if (hayStock && !d.destination_warehouse_id) {
      return { ok: false, error: "Elige el almacén al que vuelve el equipo" };
    }

    // 3) Órdenes de retirada abiertas que tocan estos equipos.
    const { data: abiertas, error: oErr } = await admin
      .from("installations")
      .select("id, reference_code, notes")
      .eq("company_id", companyId)
      .eq("customer_id", d.customer_id)
      .eq("kind", "uninstall")
      .not("status", "in", "(completed,cancelled)")
      .is("deleted_at", null);
    if (oErr) return { ok: false, error: oErr.message };
    const { cancelar, bloquean } = clasificarOrdenesAbiertas(
      (abiertas ?? []) as OrdenAbierta[],
      d.equipment_ids,
    );
    if (bloquean.length > 0) {
      const refs = bloquean.map((o) => o.reference_code ?? o.id.slice(0, 8)).join(", ");
      return {
        ok: false,
        error: `Hay una retirada programada (${refs}) que incluye también otros equipos. Selecciona todos sus equipos o ciérrala desde Instalaciones.`,
      };
    }

    // 4) Reserva de los equipos (compare-and-set): garantiza que solo un envío
    //    sigue adelante. Si no los coge todos, deshace y sale.
    const { data: reservados, error: rErr } = await admin
      .from("customer_equipment")
      .update({ is_active: false })
      .in("id", d.equipment_ids)
      .eq("company_id", companyId)
      .eq("customer_id", d.customer_id)
      .eq("is_active", true)
      .select("id");
    if (rErr) return { ok: false, error: rErr.message };
    const idsReservados = ((reservados ?? []) as Array<{ id: string }>).map((r) => r.id);
    const liberar = async () => {
      if (idsReservados.length === 0) return;
      const { error } = await admin
        .from("customer_equipment")
        .update({ is_active: true })
        .in("id", idsReservados)
        .eq("company_id", companyId);
      if (error) console.error("[retiradaManual] liberar reserva:", error.message);
    };
    if (idsReservados.length !== d.equipment_ids.length) {
      await liberar();
      return { ok: false, error: "Algún equipo se acaba de retirar desde otra pantalla. Recarga la ficha." };
    }

    // 5) Orden de retirada (mismo núcleo que la agendada).
    const instante = instanteRetirada(d.fecha_retirada, hoy, ahora, madridLocalToUtcISO);
    const nombreActor = session.full_name ?? session.email ?? session.user_id;
    const notaManual = [
      MARCA_RETIRADA_MANUAL,
      `Fecha de retirada: ${d.fecha_retirada}`,
      `Estado del equipo: ${ESTADO_EQUIPO_LABEL[d.estado_equipo]}`,
      `Motivo: ${d.motivo}`,
      `Registrada por: ${nombreActor}`,
    ].join("\n");
    let orden: { installation_id: string; reference_code: string };
    try {
      orden = await crearOrdenRetirada(admin, {
        company_id: companyId,
        user_id: session.user_id,
        customer_id: d.customer_id,
        equipment_ids: d.equipment_ids,
        destination_warehouse_id: hayStock ? d.destination_warehouse_id ?? "" : "",
        scheduled_at: instante,
        default_state: d.estado_vuelta,
        notes: notaManual,
        installer_user_id: null,
        destinos: d.destinos,
        estricto: true,
      });
    } catch (e) {
      await liberar();
      return { ok: false, error: toActionError(e) };
    }
    if (d.nota_estado) {
      await marcarLineasParaRevisar(admin, orden.installation_id, d.nota_estado);
    }

    // 6) Cierre con los mismos efectos que el del técnico (stock, baja,
    //    contrato / mantenimientos que dejan de cobrar).
    const cierre = await cerrarOrdenRetirada(admin, companyId, orden.installation_id, {
      completed_at: instante,
      actor_user_id: session.user_id,
      motivo: d.motivo,
    });
    if (!cierre.ok) {
      // ¿Se movió stock? Si la orden sigue abierta (se revirtió), no: la
      // anulamos y liberamos los equipos para poder reintentar.
      const { data: estado } = await admin
        .from("installations")
        .select("status")
        .eq("id", orden.installation_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if ((estado as { status: string } | null)?.status !== "completed") {
        await admin
          .from("installations")
          .update({ status: "cancelled", deleted_at: new Date().toISOString() })
          .eq("id", orden.installation_id)
          .eq("company_id", companyId);
        await liberar();
      }
      return { ok: false, error: cierre.error };
    }

    // 7) Cancelar las órdenes abiertas que quedaban cubiertas (para que no
    //    sigan en agenda / Mi día ni devuelvan el stock otra vez).
    const canceladas: string[] = [];
    for (const o of cancelar) {
      const nota = `${(o.notes ?? "").trim()}\n---\nCancelada: sustituida por la retirada manual ${orden.reference_code} (${d.fecha_retirada}).`;
      const { data: c, error: kErr } = await admin
        .from("installations")
        .update({ status: "cancelled", notes: nota })
        .eq("id", o.id)
        .eq("company_id", companyId)
        .not("status", "in", "(completed,cancelled)")
        .select("id");
      if (kErr) {
        console.error("[retiradaManual] cancelar orden abierta:", kErr.message);
        continue;
      }
      if ((c ?? []).length > 0) canceladas.push(o.reference_code ?? o.id);
    }

    // 8) Auditoría / timeline del cliente.
    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: d.customer_id,
      kind: "equipment.manual_uninstall",
      payload: {
        modo: "retirada manual (sin agendar)",
        installation_id: orden.installation_id,
        reference_code: orden.reference_code,
        equipment_ids: d.equipment_ids,
        fecha_retirada: d.fecha_retirada,
        motivo: d.motivo,
        destination_warehouse_id: hayStock ? d.destination_warehouse_id : null,
        estado_equipo: d.estado_equipo,
        estado_vuelta: d.estado_vuelta,
        destinos: Array.from(d.destinos.entries()).map(([id, destino]) => ({ id, destino })),
        stock_devuelto: cierre.moved,
        equipos_baja: cierre.deactivated,
        ordenes_canceladas: canceladas,
        contratos_finalizados: cierre.contratos_finalizados,
        contratos_mantenidos: cierre.contratos_mantenidos,
        contratos_mantenimiento_cancelados: cierre.contratos_mantenimiento_cancelados,
        mantenimientos_cancelados: cierre.mantenimientos_cancelados,
        avisos: cierre.avisos,
        registrada_por: nombreActor,
      },
      actor_user_id: session.user_id,
    });
    if (evErr) console.error("[retiradaManual] evento:", evErr.message);

    revalidatePath(`/clientes/${d.customer_id}`);
    revalidatePath("/instalaciones");
    revalidatePath(`/instalaciones/${orden.installation_id}`);
    revalidatePath("/agenda");
    if (hayStock && d.destination_warehouse_id) {
      revalidatePath(`/almacenes/${d.destination_warehouse_id}`);
    }
    revalidatePath("/contratos");
    revalidatePath("/mantenimientos");
    return {
      ok: true,
      installation_id: orden.installation_id,
      reference_code: orden.reference_code,
      ordenes_canceladas: canceladas,
      contratos_finalizados: cierre.contratos_finalizados,
      contratos_mantenidos: cierre.contratos_mantenidos,
      mantenimientos_cancelados: cierre.mantenimientos_cancelados,
      contratos_mantenimiento_cancelados: cierre.contratos_mantenimiento_cancelados,
      avisos: cierre.avisos,
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
