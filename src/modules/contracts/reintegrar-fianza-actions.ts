"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { resumenFianza, type PagoFianza } from "./fianza-logica";
import { deshacerDevolucionFianza, registrarDevolucionFianza } from "./fianza-nucleo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Reintegrar fianza»: devuelve al cliente la fianza que sigue cobrada en un
 * contrato YA FINALIZADO (`completed`), p. ej. cuando la retirada del equipo
 * cerró el alquiler sin decidir la fianza. Reutiliza la devolución de
 * `finalizeRentalContractAction` (registrarDevolucionFianza).
 *
 * Solo superadmin / company_admin. Idempotente: devuelve exactamente lo
 * pendiente (cobrada − devuelta − retenida); si no queda nada, error. Si dos
 * envíos coinciden, el segundo detecta el exceso y deshace el suyo.
 */
export async function reintegrarFianzaAction(input: {
  contract_id: string;
  nota?: string | null;
}): Promise<{ ok: true; devuelto_cents: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo el administrador puede reintegrar la fianza" };
    }
    if (!UUID.test(input?.contract_id ?? "")) return { ok: false, error: "Contrato no válido" };
    const nota = (input.nota ?? "").trim().slice(0, 1000) || null;
    const companyId = session.company_id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row, error: cErr } = await admin
      .from("contracts")
      .select("id, status, customer_id, reference_code")
      .eq("id", input.contract_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (cErr) return { ok: false, error: cErr.message };
    const c = row as
      | { id: string; status: string; customer_id: string | null; reference_code: string | null }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.status !== "completed") {
      return {
        ok: false,
        error: "Solo se reintegra la fianza de contratos finalizados. Si sigue en vigor, usa «Finalizar alquiler».",
      };
    }

    const leer = async () => {
      const { data, error } = await admin
        .from("contract_payments")
        .select("concept, amount_cents, status")
        .eq("contract_id", c.id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
      return resumenFianza((data ?? []) as PagoFianza[]);
    };
    const antes = await leer();
    if (antes.pendiente <= 0) {
      return { ok: false, error: "No hay fianza pendiente de reintegrar en este contrato" };
    }

    const motivo = nota ? `Reintegro de fianza. ${nota}` : "Reintegro de fianza (contrato finalizado)";
    const dev = await registrarDevolucionFianza(admin, {
      company_id: companyId,
      contract_id: c.id,
      customer_id: c.customer_id,
      cents: antes.pendiente,
      actor_user_id: session.user_id,
      notas: motivo,
    });

    // Doble envío simultáneo: si ahora se ha devuelto más de lo cobrado,
    // este envío sobra → se deshace.
    const despues = await leer();
    if (despues.devuelta + despues.retenida > despues.cobrada) {
      await deshacerDevolucionFianza(admin, dev);
      return { ok: false, error: "La fianza ya se ha reintegrado" };
    }

    const { error: evErr } = await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: c.id,
      kind: "contract.deposit_returned",
      payload: {
        return_cents: antes.pendiente,
        deposit_total_cents: antes.cobrada,
        nota,
        contract_payment_id: dev.contract_payment_id,
        wallet_entry_id: dev.wallet_entry_id,
      },
      actor_user_id: session.user_id,
    });
    if (evErr) console.error("[reintegrarFianza] evento:", evErr.message);

    revalidatePath(`/contratos/${c.id}`);
    revalidatePath("/contratos/alquileres");
    revalidatePath("/wallet");
    return { ok: true, devuelto_cents: antes.pendiente };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
