// =============================================================================
// reconcile.ts
// Helpers PUROS para reconstruir sales_records desde contracts firmados/activos.
// NO lleva "use server" — se usa desde:
//   - server action `backfillSalesRecordsAction` (botón "Recalcular ventas")
//   - cron diario (autoreconcilio para que no haga falta el botón)
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReconcileResult {
  contracts_scanned: number;
  contracts_with_missing_records: number;
  records_inserted: number;
  errors: string[];
}

interface Options {
  /** Si true: borra previos antes de reinsertar (modo "Recalcular ventas"). */
  force?: boolean;
}

/**
 * Reconstruye `sales_records` para los contratos firmados/activos de una
 * empresa. Idempotente y ultra-defensivo.
 *
 *  - Modo NORMAL (cron): solo inserta para contratos SIN registros previos.
 *    No toca contratos que ya tienen sales_records (preserva ajustes
 *    manuales si los hubiera).
 *
 *  - Modo FORCE (botón "Recalcular ventas"): borra y reinserta TODO.
 *
 * El período (year/month) se calcula con `signed_at` del contrato — NO con
 * la fecha actual — para que los objetivos del mes correcto reciban la
 * venta aunque el reconcilio se ejecute más tarde.
 */
export async function reconcileSalesRecordsForCompany(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  companyId: string,
  opts: Options = {},
): Promise<ReconcileResult> {
  const force = !!opts.force;
  const result: ReconcileResult = {
    contracts_scanned: 0,
    contracts_with_missing_records: 0,
    records_inserted: 0,
    errors: [],
  };

  // 1) Cargar contratos firmados/activos. Query defensiva (signed_at y
  // assigned_user_id son columnas opcionales que añadieron migraciones
  // tardías — si el cache de PostgREST está sin recargar reintentamos con
  // un subset mínimo).
  const BASE_COLS =
    "id, customer_id, plan_type, total_cash_cents, monthly_cents, duration_months, created_at, status";
  const FULL_COLS = `${BASE_COLS}, assigned_user_id, signed_at`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  async function loadContracts(cols: string) {
    return adminAny
      .from("contracts")
      .select(cols)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("status", ["signed", "active"]);
  }
  let { data: contractsData, error: cErr } = await loadContracts(FULL_COLS);
  if (cErr && /column .* does not exist/i.test(cErr.message ?? "")) {
    const retry = await loadContracts(BASE_COLS);
    contractsData = retry.data;
    cErr = retry.error;
  }
  if (cErr) {
    result.errors.push(`load contracts: ${cErr.message}`);
    return result;
  }

  const contracts = (contractsData ?? []) as Array<{
    id: string;
    customer_id: string | null;
    plan_type: "cash" | "rental" | "renting";
    total_cash_cents: number | null;
    monthly_cents: number | null;
    duration_months: number | null;
    assigned_user_id?: string | null;
    signed_at?: string | null;
    created_at: string;
    status: string;
  }>;
  result.contracts_scanned = contracts.length;
  if (contracts.length === 0) return result;

  // 2) Saber qué contratos YA tienen sales_records (para no duplicar
  // trabajo en modo no-force).
  const contractIds = contracts.map((c) => c.id);
  const existingByContract = new Set<string>();
  if (!force && contractIds.length > 0) {
    const { data: existing } = await adminAny
      .from("sales_records")
      .select("contract_id")
      .in("contract_id", contractIds);
    for (const r of ((existing ?? []) as Array<{ contract_id: string }>)) {
      existingByContract.add(r.contract_id);
    }
  }

  // 3) Por contrato — calcular y reinsertar
  for (const cf of contracts) {
    if (!force && existingByContract.has(cf.id)) continue;
    result.contracts_with_missing_records += 1;
    try {
      // TMK origen
      let tmkUserId: string | null = null;
      if (cf.customer_id) {
        const { data: cust } = await adminAny
          .from("customers")
          .select("source_lead_id")
          .eq("id", cf.customer_id)
          .maybeSingle();
        const sourceLeadId = (cust as { source_lead_id: string | null } | null)
          ?.source_lead_id;
        if (sourceLeadId) {
          const { data: l } = await adminAny
            .from("leads")
            .select("origin_tmk_user_id")
            .eq("id", sourceLeadId)
            .maybeSingle();
          tmkUserId =
            (l as { origin_tmk_user_id: string | null } | null)
              ?.origin_tmk_user_id ?? null;
        }
      }

      // Importe total
      let totalCents = 0;
      if (cf.plan_type === "cash") {
        totalCents = cf.total_cash_cents ?? 0;
      } else {
        totalCents = (cf.monthly_cents ?? 0) * (cf.duration_months ?? 0);
      }

      // Items
      const { data: contractItems } = await adminAny
        .from("contract_items")
        .select("id, product_id, quantity")
        .eq("contract_id", cf.id);
      const items = (contractItems ?? []) as Array<{
        id: string;
        product_id: string;
        quantity: number;
      }>;

      // Periodo: usar signed_at; fallback created_at
      const refDate = new Date(cf.signed_at ?? cf.created_at);
      const periodYear = refDate.getFullYear();
      const periodMonth = refDate.getMonth() + 1;

      const recordRows = (items.length > 0 ? items : [null]).map((it) => ({
        company_id: companyId,
        contract_id: cf.id,
        contract_item_id: it?.id ?? null,
        sales_user_id: cf.assigned_user_id ?? null,
        tmk_user_id: tmkUserId,
        installer_user_id: null,
        plan_type: cf.plan_type,
        total_cents:
          items.length > 0
            ? Math.round(totalCents / items.length)
            : totalCents,
        monthly_cents: cf.monthly_cents,
        duration_months: cf.duration_months,
        period_year: periodYear,
        period_month: periodMonth,
        recorded_at: refDate.toISOString(),
      }));

      if (force) {
        await adminAny.from("sales_records").delete().eq("contract_id", cf.id);
      }

      const { error: insErr } = await adminAny
        .from("sales_records")
        .insert(recordRows);
      if (insErr) {
        result.errors.push(`Contrato ${cf.id.slice(0, 8)}: ${insErr.message}`);
      } else {
        result.records_inserted += recordRows.length;
      }
    } catch (e) {
      result.errors.push(
        `Contrato ${cf.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return result;
}
