"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Regenera sales_records a partir de los contratos firmados de la empresa.
 * Se usa cuando el insert automático en `markContractSigned` fue silenciado
 * por algún error (enum, FK, schema cache…) y el dashboard de objetivos
 * sigue mostrando 0 € pese a tener contratos firmados.
 *
 * - Solo admin (company_admin / superadmin) puede ejecutarlo.
 * - Es idempotente: borra los sales_records previos del contrato antes de
 *   reinsertar (no duplica).
 * - period_year/month se calcula con `signed_at` del contrato (o created_at
 *   como fallback) — NO con la fecha actual; así los objetivos del mes
 *   correcto reciben el cómputo aunque el backfill se ejecute más tarde.
 */
export async function backfillSalesRecordsAction(): Promise<{
  contracts_processed: number;
  records_inserted: number;
  errors: string[];
}> {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede ejecutar el backfill.");
  }
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Cargar contratos firmados o activos (no cancelados, no borrados).
  //    Query defensiva: primero intentamos con todas las columnas opcionales
  //    (`assigned_user_id`, `signed_at`); si PostgREST devuelve "column does
  //    not exist" (cache obsoleto o migración pendiente) reintentamos con
  //    el subconjunto mínimo. La regla feedback_migrations_defensive lo
  //    exige para cualquier columna añadida en migraciones tardías.
  const BASE_COLS = "id, customer_id, plan_type, total_cash_cents, monthly_cents, duration_months, created_at, status";
  const FULL_COLS = `${BASE_COLS}, assigned_user_id, signed_at`;

  async function loadContracts(cols: string) {
    return admin
      .from("contracts")
      .select(cols)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .in("status", ["signed", "active"]);
  }
  let { data: contractsData, error: cErr } = await loadContracts(FULL_COLS);
  if (cErr && /column .* does not exist/i.test(cErr.message ?? "")) {
    console.warn(
      "[backfillSalesRecords] reintentando sin columnas opcionales:",
      cErr.message,
    );
    const retry = await loadContracts(BASE_COLS);
    contractsData = retry.data;
    cErr = retry.error;
  }
  if (cErr) throw new Error(`Error cargando contratos: ${cErr.message}`);

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

  const errors: string[] = [];
  let inserted = 0;

  for (const cf of contracts) {
    try {
      // TMK origen
      let tmkUserId: string | null = null;
      if (cf.customer_id) {
        const { data: cust } = await admin
          .from("customers")
          .select("source_lead_id")
          .eq("id", cf.customer_id)
          .maybeSingle();
        const sourceLeadId = (cust as { source_lead_id: string | null } | null)
          ?.source_lead_id;
        if (sourceLeadId) {
          const { data: l } = await admin
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
      const { data: contractItems } = await admin
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
        company_id: session.company_id!,
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

      // Idempotencia: borrar antes de reinsertar
      await admin.from("sales_records").delete().eq("contract_id", cf.id);

      const { error: insErr } = await admin
        .from("sales_records")
        .insert(recordRows);
      if (insErr) {
        errors.push(`Contrato ${cf.id.slice(0, 8)}: ${insErr.message}`);
      } else {
        inserted += recordRows.length;
      }
    } catch (e) {
      errors.push(
        `Contrato ${cf.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/objetivos");
  revalidatePath("/configuracion/objetivos");

  return {
    contracts_processed: contracts.length,
    records_inserted: inserted,
    errors,
  };
}
