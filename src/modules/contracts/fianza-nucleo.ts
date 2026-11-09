import "server-only";
import { CONCEPTO_DEVOLUCION_FIANZA } from "./fianza-logica";

/**
 * Devolución de fianza: movimiento de SALIDA (importe negativo con concepto
 * "Devolución fianza") en contract_payments + wallet_entries enlazados. Es el
 * paso 4 de `finalizeRentalContractAction`, sacado aquí para reutilizarlo en
 * «Reintegrar fianza» (contrato ya `completed` por una retirada).
 *
 * Requiere la migración 20261002130100 (CHECK que admite negativos solo en
 * devoluciones). Si algo falla, deshace lo que creó y lanza Error con el
 * mensaje para el usuario. No es una server action.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export async function registrarDevolucionFianza(
  admin: Admin,
  p: {
    company_id: string;
    contract_id: string;
    customer_id: string | null;
    cents: number;
    actor_user_id: string;
    notas: string | null;
  },
): Promise<{ contract_payment_id: string; wallet_entry_id: string }> {
  if (!Number.isInteger(p.cents) || p.cents <= 0) throw new Error("Importe de devolución no válido");
  const ahora = new Date().toISOString();
  const { data: cpRow, error: cpErr } = await admin
    .from("contract_payments")
    .insert({
      company_id: p.company_id,
      contract_id: p.contract_id,
      concept: CONCEPTO_DEVOLUCION_FIANZA,
      amount_cents: -p.cents,
      method: "transfer",
      moment: "intermediate",
      status: "validated",
      collected_at: ahora,
      collected_by_user_id: p.actor_user_id,
      validated_at: ahora,
      validated_by_user_id: p.actor_user_id,
      notes: p.notas,
    })
    .select("id")
    .single();
  if (cpErr) {
    throw new Error(
      /amount_cents_check/i.test(cpErr.message ?? "")
        ? "Falta aplicar la migración de facturación del 02-10-2026 para registrar devoluciones de fianza."
        : `No se pudo registrar la devolución de la fianza: ${cpErr.message}`,
    );
  }
  const cpId = (cpRow as { id: string }).id;
  const { data: weRow, error: weErr } = await admin
    .from("wallet_entries")
    .insert({
      company_id: p.company_id,
      contract_id: p.contract_id,
      contract_payment_id: cpId,
      customer_id: p.customer_id,
      concept: CONCEPTO_DEVOLUCION_FIANZA,
      amount_cents: -p.cents,
      method: "transfer",
      status: "validated",
      collected_at: ahora,
      validated_at: ahora,
      validated_by_user_id: p.actor_user_id,
      notes: p.notas,
    })
    .select("id")
    .single();
  if (weErr) {
    await admin.from("contract_payments").delete().eq("id", cpId);
    throw new Error(`No se pudo registrar la salida de caja de la fianza: ${weErr.message}`);
  }
  const weId = (weRow as { id: string }).id;
  const { error: lkErr } = await admin
    .from("contract_payments")
    .update({ wallet_entry_id: weId })
    .eq("id", cpId);
  if (lkErr) console.error("[registrarDevolucionFianza] enlazar wallet:", lkErr.message);
  return { contract_payment_id: cpId, wallet_entry_id: weId };
}

/** Borra una devolución creada por `registrarDevolucionFianza`. */
export async function deshacerDevolucionFianza(
  admin: Admin,
  ids: { contract_payment_id: string; wallet_entry_id: string },
): Promise<void> {
  await admin.from("contract_payments").update({ wallet_entry_id: null }).eq("id", ids.contract_payment_id);
  await admin.from("wallet_entries").delete().eq("id", ids.wallet_entry_id);
  await admin.from("contract_payments").delete().eq("id", ids.contract_payment_id);
}
