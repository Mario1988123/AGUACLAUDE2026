"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";

/**
 * Cierre de contrato de alquiler. A diferencia de cancelContract (que es
 * una cancelación temprana con soft-delete), aquí el contrato pasa a
 * `completed` porque el servicio termina con normalidad (o por baja
 * voluntaria del cliente). Tres modos según qué pasa con la fianza:
 *
 *  - return_full     → devolvemos la fianza íntegra al cliente.
 *  - retain_penalty  → la empresa retiene la fianza completa como
 *                       penalización (cliente rompe antes de tiempo).
 *  - partial_return  → devolvemos `partial_return_cents` al cliente y el
 *                       resto se retiene como penalización.
 *
 * El movimiento se registra como un nuevo `contract_payment` con
 * `amount_cents` negativo si hay devolución (el concepto explica el caso)
 * y un wallet_entry vinculado para que la salida quede en caja. Requiere la
 * migración 20261002130100 (CHECK que admite negativos solo en devoluciones).
 *
 * [decide] Los cobros PENDIENTES ya facturados (p. ej. la cuota del último
 * mes) no se cancelan al finalizar: el servicio se prestó y se deben. Solo
 * al CANCELAR un contrato se anulan los pendientes. Ver pregunta de negocio 4.
 */
const finalizeSchema = z.object({
  contract_id: z.string().uuid(),
  reason: z.string().trim().min(1, "Indica el motivo del cierre"),
  deposit_action: z.enum(["return_full", "retain_penalty", "partial_return", "none"]),
  partial_return_cents: z.coerce.number().int().min(0).nullish(),
});

export async function finalizeRentalContractAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) {
      return {
        ok: false,
        error: "Solo admin o director comercial puede finalizar alquileres",
      };
    }
    const parsed = parseOrFriendly(finalizeSchema, input, "Finalizar alquiler");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Cargar contrato + fianzas registradas
    const { data: row } = await admin
      .from("contracts")
      .select("id, status, plan_type, company_id, customer_id")
      .eq("id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    const c = row as
      | {
          id: string;
          status: string;
          plan_type: string;
          company_id: string;
          customer_id: string | null;
        }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (c.plan_type !== "rental")
      return { ok: false, error: "Solo aplica a contratos de alquiler" };
    if (!["signed", "active"].includes(c.status))
      return { ok: false, error: `Contrato en estado ${c.status}; no se puede finalizar` };

    // Suma de fianzas cobradas (contract_payments con concepto "Fianza")
    const { data: deps } = await admin
      .from("contract_payments")
      .select("amount_cents, status, concept")
      .eq("contract_id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .ilike("concept", "Fianza%");
    type D = { amount_cents: number; status: string; concept: string };
    const depositRows = ((deps ?? []) as D[]).filter(
      (d) => d.status === "validated" || d.status === "collected_pending_validation",
    );
    const depositTotal = depositRows.reduce((s, d) => s + d.amount_cents, 0);

    // 2) Calcular importes según modo
    let returnCents = 0;
    let retainCents = 0;
    if (parsed.deposit_action === "return_full") {
      returnCents = depositTotal;
    } else if (parsed.deposit_action === "retain_penalty") {
      retainCents = depositTotal;
    } else if (parsed.deposit_action === "partial_return") {
      const part = parsed.partial_return_cents ?? 0;
      if (part > depositTotal) {
        return {
          ok: false,
          error: `Devolución parcial (${(part / 100).toFixed(2)} €) supera la fianza cobrada (${(depositTotal / 100).toFixed(2)} €)`,
        };
      }
      returnCents = part;
      retainCents = depositTotal - part;
    }

    // 3) Cerrar el contrato PRIMERO y de forma condicional: si dos clics
    //    llegan a la vez, solo uno pasa de signed/active a completed y solo
    //    ese registra la devolución (antes un doble clic devolvía dos veces).
    const { data: cerrado, error: upErr } = await admin
      .from("contracts")
      .update({ status: "completed" })
      .eq("id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .in("status", ["signed", "active"])
      .select("id");
    if (upErr) return { ok: false, error: upErr.message };
    if (((cerrado ?? []) as unknown[]).length === 0) {
      return { ok: false, error: "El contrato ya se ha finalizado o ha cambiado de estado" };
    }
    const deshacerCierre = async () => {
      await admin
        .from("contracts")
        .update({ status: c.status })
        .eq("id", parsed.contract_id)
        .eq("company_id", session.company_id)
        .eq("status", "completed");
    };
    const creados: Array<{ tabla: string; id: string }> = [];
    const deshacerMovimientos = async () => {
      for (const x of creados.reverse()) {
        await admin.from(x.tabla).delete().eq("id", x.id);
      }
    };

    // 4) Devolución de fianza: movimiento de SALIDA. Las tablas no tienen
    //    columna de sentido, así que la salida es un importe negativo con
    //    concepto "Devolución fianza"; la migración 20261002130100 permite
    //    importes negativos SOLO para devoluciones validadas. Antes el insert
    //    chocaba con CHECK (amount_cents >= 0), solo se escribía en
    //    console.error y el contrato quedaba cerrado sin rastro de la
    //    devolución. Ahora, si falla, no se cierra nada.
    const ahora = new Date().toISOString();
    if (returnCents > 0) {
      const { data: cpRow, error: cpErr } = await admin
        .from("contract_payments")
        .insert({
          company_id: c.company_id,
          contract_id: c.id,
          concept: "Devolución fianza",
          amount_cents: -returnCents,
          method: "transfer",
          moment: "intermediate",
          status: "validated",
          collected_at: ahora,
          collected_by_user_id: session.user_id,
          validated_at: ahora,
          validated_by_user_id: session.user_id,
          notes: parsed.reason,
        })
        .select("id")
        .single();
      if (cpErr) {
        await deshacerCierre();
        return {
          ok: false,
          error: /amount_cents_check/i.test(cpErr.message ?? "")
            ? "Falta aplicar la migración de facturación del 02-10-2026 para registrar devoluciones de fianza. No se ha cerrado el contrato."
            : `No se pudo registrar la devolución de la fianza: ${cpErr.message}`,
        };
      }
      const cpId = (cpRow as { id: string }).id;
      creados.push({ tabla: "contract_payments", id: cpId });
      const { data: weRow, error: weErr } = await admin
        .from("wallet_entries")
        .insert({
          company_id: c.company_id,
          contract_id: c.id,
          contract_payment_id: cpId,
          customer_id: c.customer_id,
          concept: "Devolución fianza",
          amount_cents: -returnCents,
          method: "transfer",
          status: "validated",
          collected_at: ahora,
          validated_at: ahora,
          validated_by_user_id: session.user_id,
          notes: parsed.reason,
        })
        .select("id")
        .single();
      if (weErr) {
        await deshacerMovimientos();
        await deshacerCierre();
        return { ok: false, error: `No se pudo registrar la salida de caja de la fianza: ${weErr.message}` };
      }
      creados.push({ tabla: "wallet_entries", id: (weRow as { id: string }).id });
      await admin
        .from("contract_payments")
        .update({ wallet_entry_id: (weRow as { id: string }).id })
        .eq("id", cpId);
    }

    // 5) Retención: se deja constancia (no es salida de caja). Pendiente de
    //    negocio (pregunta 8): si la fianza retenida es un ingreso aparte o
    //    la misma fianza que cambia de concepto. Se mantiene como estaba,
    //    pero ahora si falla no se cierra el contrato a medias.
    if (retainCents > 0) {
      const { data: rtRow, error: rtErr } = await admin
        .from("contract_payments")
        .insert({
          company_id: c.company_id,
          contract_id: c.id,
          concept: "Retención fianza (penalización)",
          amount_cents: retainCents,
          method: "transfer",
          moment: "intermediate",
          status: "validated",
          collected_at: ahora,
          collected_by_user_id: session.user_id,
          validated_at: ahora,
          validated_by_user_id: session.user_id,
          notes: parsed.reason,
        })
        .select("id")
        .single();
      if (rtErr) {
        await deshacerMovimientos();
        await deshacerCierre();
        return { ok: false, error: `No se pudo registrar la retención de la fianza: ${rtErr.message}` };
      }
      creados.push({ tabla: "contract_payments", id: (rtRow as { id: string }).id });
    }

    // 6) Evento timeline
    await admin.from("events").insert({
      company_id: c.company_id,
      subject_type: "contract",
      subject_id: parsed.contract_id,
      kind: "contract.rental_finalized",
      payload: {
        reason: parsed.reason,
        deposit_action: parsed.deposit_action,
        deposit_total_cents: depositTotal,
        return_cents: returnCents,
        retain_cents: retainCents,
      },
      actor_user_id: session.user_id,
    });

    // 7) Cancelar mantenimientos futuros que ya no aplican
    try {
      await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled" })
        .eq("contract_id", parsed.contract_id)
        .in("status", ["scheduled"]);
    } catch (e) {
      console.error("[finalize-rental] cancel future maintenance failed:", e);
    }

    revalidatePath(`/contratos/${parsed.contract_id}`);
    revalidatePath("/contratos");
    revalidatePath("/contratos/alquileres");
    revalidatePath("/wallet");
    revalidatePath("/mantenimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
