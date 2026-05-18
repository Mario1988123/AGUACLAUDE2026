// =============================================================================
// reconcile-payments.ts
// Detecta y arregla inconsistencias entre wallet_entries y contract_payments.
// Patrón clásico: el cobro avanza por un lado y el otro lado se queda atrás
// porque el insert falló silenciosamente, el cobro se hizo antes de añadir la
// vinculación, o un upstream cambió status sin propagar.
//
// Usado por:
//   - Cron diario (red de seguridad — corre para todas las empresas).
//   - Action manual "Sincronizar pagos" desde la cartera de alquileres.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReconcilePaymentsResult {
  /** Wallets que estaban sin contract_payment_id pero deberían tenerlo. */
  wallet_links_repaired: number;
  /** contract_payments status no validated cuyo wallet sí lo está → propagados. */
  payments_propagated: number;
  /** wallet sin link cuyo contract_payment ya estaba en validated/collected. */
  walket_status_back_propagated: number;
  errors: string[];
}

interface Options {
  /** Si se da, restringe al contrato/s indicado. */
  contractIds?: string[];
}

/**
 * Reconcilia para una empresa. Idempotente. Modo:
 *
 *  1) wallet.contract_payment_id IS NULL pero hay contract_id + amount match
 *     con un contract_payment pending → vincular.
 *
 *  2) contract_payment.wallet_entry_id IS NULL pero hay contract_id + amount
 *     match con un wallet collected/validated/settled → vincular.
 *
 *  3) wallet status validated/settled + cp_id link pero contract_payment
 *     status NO validated → propagar a validated.
 *
 *  4) contract_payment status validated/collected_pending_validation pero
 *     wallet pending (raro, lo dejamos para inspección humana).
 */
export async function reconcileContractPaymentsForCompany(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  companyId: string,
  opts: Options = {},
): Promise<ReconcilePaymentsResult> {
  const result: ReconcilePaymentsResult = {
    wallet_links_repaired: 0,
    payments_propagated: 0,
    walket_status_back_propagated: 0,
    errors: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // Cargar wallet_entries y contract_payments con contract_id no nulo.
  // Si opts.contractIds está, restringimos.
  const walletQ = adminAny
    .from("wallet_entries")
    .select(
      "id, contract_id, contract_payment_id, amount_cents, status, method, collected_at, validated_at",
    )
    .eq("company_id", companyId)
    .not("contract_id", "is", null);
  const cpQ = adminAny
    .from("contract_payments")
    .select(
      "id, contract_id, wallet_entry_id, amount_cents, status, concept, created_at",
    )
    .eq("company_id", companyId);
  const wQuery = opts.contractIds && opts.contractIds.length > 0
    ? walletQ.in("contract_id", opts.contractIds)
    : walletQ;
  const cQuery = opts.contractIds && opts.contractIds.length > 0
    ? cpQ.in("contract_id", opts.contractIds)
    : cpQ;
  const [wallets, payments] = await Promise.all([wQuery, cQuery]);
  if (wallets.error) {
    result.errors.push(`load wallets: ${wallets.error.message}`);
    return result;
  }
  if (payments.error) {
    result.errors.push(`load contract_payments: ${payments.error.message}`);
    return result;
  }
  type W = {
    id: string;
    contract_id: string | null;
    contract_payment_id: string | null;
    amount_cents: number;
    status: string;
    method: string;
    collected_at: string | null;
    validated_at: string | null;
  };
  type CP = {
    id: string;
    contract_id: string;
    wallet_entry_id: string | null;
    amount_cents: number;
    status: string;
    concept: string;
    created_at: string;
  };
  const ws = (wallets.data ?? []) as W[];
  const cps = (payments.data ?? []) as CP[];

  // Indexar CPs por contract → lista ordenada por created_at asc.
  const cpsByContract = new Map<string, CP[]>();
  for (const cp of cps) {
    if (!cpsByContract.has(cp.contract_id)) cpsByContract.set(cp.contract_id, []);
    cpsByContract.get(cp.contract_id)!.push(cp);
  }
  for (const list of cpsByContract.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // Pase 1+2+3: por cada wallet, decidir acción.
  for (const w of ws) {
    if (!w.contract_id) continue;
    try {
      let cpId = w.contract_payment_id;

      // Si no hay link, buscar match por importe en pending/collected_pending_validation.
      if (!cpId) {
        const candidates = (cpsByContract.get(w.contract_id) ?? []).filter(
          (cp) =>
            cp.amount_cents === w.amount_cents &&
            (cp.status === "pending" ||
              cp.status === "collected_pending_validation") &&
            !cp.wallet_entry_id,
        );
        if (candidates.length > 0) {
          cpId = candidates[0]!.id;
          await adminAny
            .from("wallet_entries")
            .update({ contract_payment_id: cpId })
            .eq("id", w.id);
          await adminAny
            .from("contract_payments")
            .update({ wallet_entry_id: w.id })
            .eq("id", cpId);
          result.wallet_links_repaired += 1;
          // Re-busca el CP actualizado para la siguiente fase
          const cpRow = candidates[0]!;
          cpRow.wallet_entry_id = w.id;
        }
      }

      // Si hay link y wallet está validated/settled pero cp no, propagar.
      if (cpId) {
        const cp = cps.find((x) => x.id === cpId);
        if (cp && cp.status !== "validated") {
          if (w.status === "validated" || w.status === "settled") {
            await adminAny
              .from("contract_payments")
              .update({
                status: "validated",
                collected_at: w.collected_at ?? new Date().toISOString(),
                validated_at: w.validated_at ?? new Date().toISOString(),
                wallet_entry_id: w.id,
              })
              .eq("id", cp.id);
            result.payments_propagated += 1;
          } else if (
            w.status === "collected" &&
            cp.status === "pending"
          ) {
            await adminAny
              .from("contract_payments")
              .update({
                status: "collected_pending_validation",
                collected_at: w.collected_at ?? new Date().toISOString(),
                wallet_entry_id: w.id,
              })
              .eq("id", cp.id);
            result.payments_propagated += 1;
          }
        }
      }
    } catch (e) {
      result.errors.push(
        `wallet ${w.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Pase 4: contract_payments validated pero wallet sin estado coherente
  // (raro, lo invertimos solo si el wallet está en collected/pending_settlement).
  for (const cp of cps) {
    if (cp.status !== "validated" || !cp.wallet_entry_id) continue;
    const w = ws.find((x) => x.id === cp.wallet_entry_id);
    if (!w) continue;
    if (w.status === "collected" || w.status === "pending_settlement") {
      try {
        const finalStatus = w.method === "cash" ? "settled" : "validated";
        await adminAny
          .from("wallet_entries")
          .update({
            status: finalStatus,
            validated_at: new Date().toISOString(),
            ...(finalStatus === "settled" ? { settled_at: new Date().toISOString() } : {}),
          })
          .eq("id", w.id);
        result.walket_status_back_propagated += 1;
      } catch (e) {
        result.errors.push(
          `back-prop wallet ${w.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return result;
}
