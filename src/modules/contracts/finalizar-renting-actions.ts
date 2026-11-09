"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { formatDateES } from "@/shared/lib/format-date";
import { anadirNota, notaRentingFinalizado } from "@/modules/customers/retirada-logica";
import {
  cancelarMantenimientosProgramadosContrato,
  marcarContratoCompletado,
  revertirContratoCompletado,
} from "./finalizar-contrato-nucleo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Finalizar renting» (Mario 2026-11-09). No existía nada para acabar un
 * renting (`finalizeRentalContractAction` solo admite alquiler).
 *
 * Con lo que YA hay en el modelo:
 *  1. El contrato pasa a `completed` (núcleo compartido con el cierre del
 *     alquiler y la retirada): deja de generar cuotas y se cancelan TODOS sus
 *     mantenimientos pendientes (las visitas que obligaba el contrato).
 *  2. Los equipos del contrato siguen ACTIVOS en el cliente y, como el
 *     contrato ya no está vivo, dejan de contar como renting: se pueden
 *     retirar y el cliente se puede dar de baja.
 *  3. La modalidad del equipo pasa a «Equipo instalado» (acquisition_type
 *     'installed') y queda la nota «mantenimiento no obligatorio». Desde la
 *     ficha del cliente se le puede «Proponer mantenimiento» (contrato de
 *     mantenimiento voluntario, flujo existente).
 * No hace prorrateo, penalización ni nada con la financiera.
 */
export async function finalizarRentingAction(input: {
  contract_id: string;
  motivo: string;
}): Promise<{ ok: true; equipos: number; mantenimientos_cancelados: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // Solo admin (Mario 2026-11-09).
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo el administrador puede finalizar un renting" };
    }
    if (!UUID.test(input?.contract_id ?? "")) return { ok: false, error: "Contrato no válido" };
    const motivo = (input.motivo ?? "").trim();
    if (motivo.length < 5) {
      return { ok: false, error: "Indica el motivo (mínimo 5 caracteres)" };
    }
    const companyId = session.company_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: row, error: cErr } = await admin
      .from("contracts")
      .select("id, status, plan_type, customer_id, reference_code, source_equipment_id")
      .eq("id", input.contract_id)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (cErr) return { ok: false, error: cErr.message };
    const c = row as
      | {
          id: string;
          status: string;
          plan_type: string;
          customer_id: string | null;
          reference_code: string | null;
          source_equipment_id: string | null;
        }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.plan_type !== "renting") return { ok: false, error: "Solo aplica a contratos de renting" };
    if (c.status !== "signed" && c.status !== "active") {
      return { ok: false, error: `El contrato está en estado ${c.status}; no se puede finalizar` };
    }

    // Equipos del contrato (por su instalación y, en los heredados, por
    // source_equipment_id).
    const { data: insts, error: iErr } = await admin
      .from("installations")
      .select("id")
      .eq("company_id", companyId)
      .eq("contract_id", c.id);
    if (iErr) return { ok: false, error: iErr.message };
    const instIds = ((insts ?? []) as Array<{ id: string }>).map((x) => x.id);
    const equipos = new Map<string, string | null>();
    if (instIds.length > 0) {
      const { data, error } = await admin
        .from("customer_equipment")
        .select("id, notes")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("installation_id", instIds);
      if (error) return { ok: false, error: error.message };
      for (const e of (data ?? []) as Array<{ id: string; notes: string | null }>) equipos.set(e.id, e.notes);
    }
    if (c.source_equipment_id) {
      const { data, error } = await admin
        .from("customer_equipment")
        .select("id, notes")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("id", c.source_equipment_id);
      if (error) return { ok: false, error: error.message };
      for (const e of (data ?? []) as Array<{ id: string; notes: string | null }>) equipos.set(e.id, e.notes);
    }

    // 1) Contrato a completed (compare-and-set: dos clics → uno solo).
    const { cerrado } = await marcarContratoCompletado(admin, companyId, c.id);
    if (!cerrado) return { ok: false, error: "El contrato ya se ha finalizado o ha cambiado de estado" };

    // 2) Nota "mantenimiento no obligatorio" en cada equipo.
    const ref = c.reference_code ?? c.id.slice(0, 8);
    const nota = notaRentingFinalizado(ref, formatDateES(new Date()));
    for (const [id, notas] of equipos) {
      const { error } = await admin
        .from("customer_equipment")
        // Modalidad → "Equipo instalado" (Mario 2026-11-09): deja de ser renting.
        .update({ notes: anadirNota(notas, nota), acquisition_type: "installed" })
        .eq("id", id)
        .eq("company_id", companyId);
      if (error) {
        // Sin la nota no pasa nada grave, pero mejor dejarlo como estaba.
        await revertirContratoCompletado(admin, companyId, c.id, c.status);
        return { ok: false, error: `No se pudo actualizar el equipo: ${error.message}` };
      }
    }

    // 3) Mantenimientos programados por el contrato: ya no son obligatorios.
    const cancelados = await cancelarMantenimientosProgramadosContrato(admin, companyId, c.id);

    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: c.id,
      kind: "contract.renting_finalized",
      payload: {
        reason: motivo,
        equipment_ids: Array.from(equipos.keys()),
        mantenimiento: "no obligatorio",
        mantenimientos_cancelados: cancelados,
      },
      actor_user_id: session.user_id,
    });
    if (evErr) console.error("[finalizarRenting] evento:", evErr.message);

    revalidatePath(`/contratos/${c.id}`);
    revalidatePath("/contratos");
    revalidatePath("/mantenimientos");
    if (c.customer_id) revalidatePath(`/clientes/${c.customer_id}`);
    return { ok: true, equipos: equipos.size, mantenimientos_cancelados: cancelados };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
