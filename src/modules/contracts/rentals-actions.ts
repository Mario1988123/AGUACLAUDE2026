"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface RentalRow {
  id: string;
  reference_code: string | null;
  customer_id: string;
  customer_name: string;
  status: string;
  /** Si está pausado (paused_at NOT NULL). */
  is_paused: boolean;
  paused_at: string | null;
  pause_reason: string | null;
  monthly_cents: number | null;
  total_cash_cents: number | null;
  duration_months: number | null;
  duration_months_original: number | null;
  permanence_months: number | null;
  payment_state: string | null;
  start_date: string | null;
  end_date_est: string | null;
  months_elapsed: number | null;
  months_left: number | null;
  /** % cumplido del contrato (0-100). null si no hay duración. */
  progress_pct: number | null;
  /** Si la permanencia ya se ha cumplido. true si permanence_months=null o 0. */
  permanence_done: boolean;
  /** Suma de fianzas cobradas (contract_payments concept ilike 'Fianza%' y status validated/collected). */
  deposit_collected_cents: number;
  /** Último cobro registrado (contract_payments más reciente). */
  last_payment_at: string | null;
  last_payment_status: string | null;
  last_payment_amount_cents: number | null;
  /** Mantenimientos pendientes (scheduled) asociados al contrato. */
  maintenance_pending: number;
  /** Mantenimientos hechos (completed) asociados al contrato. */
  maintenance_done: number;
  /** Alerta calculada: 'overdue', 'expiring_soon', 'unpaid', 'paused', null. */
  alert: "overdue" | "expiring_soon" | "unpaid" | "paused" | null;
}

export interface RentalsDashboard {
  rows: RentalRow[];
  kpi: {
    active_count: number;
    paused_count: number;
    /** Suma de monthly_cents de los activos NO pausados (lo que se factura este mes). */
    mrr_cents: number;
    expiring_soon: number; // < 3 meses restantes
    unpaid: number; // último contract_payment pendiente/rechazado
    permanence_done: number; // ya cumplieron permanencia → susceptibles de baja
  };
}

/**
 * Dashboard de alquileres: lista contratos plan_type='rental' activos con
 * datos calculados (meses transcurridos/restantes, próximo cobro, estado
 * mantenimientos). Sirve para la sub-página /contratos/alquileres.
 *
 * NO es un módulo aparte — los alquileres son una vista filtrada del módulo
 * Contratos con info adicional pensada para la gestión recurrente (remesas,
 * baja por fin de contrato, etc.).
 */
export async function getRentalsDashboard(): Promise<RentalsDashboard> {
  const session = await requireSession();
  if (!session.company_id) return { rows: [], kpi: emptyKpi() };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cargar contratos rental activos/signed/completed (todos los relevantes).
  // Excluimos draft, cancelled, pending_*.
  let contractCols =
    "id, reference_code, customer_id, status, plan_type, total_cash_cents, monthly_cents, duration_months, duration_months_original, permanence_months, payment_state, service_start_date, signed_at, created_at, paused_at, pause_reason";
  let r = await admin
    .from("contracts")
    .select(contractCols)
    .eq("company_id", session.company_id)
    .eq("plan_type", "rental")
    .is("deleted_at", null)
    .in("status", ["signed", "active", "completed"])
    .order("created_at", { ascending: false });
  if (
    r.error &&
    /payment_state|service_start_date|permanence_months|paused_at|duration_months_original/i.test(
      r.error.message ?? "",
    )
  ) {
    // Fallback defensivo si alguna migración tardía no está aplicada.
    contractCols =
      "id, reference_code, customer_id, status, plan_type, total_cash_cents, monthly_cents, duration_months, signed_at, created_at";
    r = await admin
      .from("contracts")
      .select(contractCols)
      .eq("company_id", session.company_id)
      .eq("plan_type", "rental")
      .is("deleted_at", null)
      .in("status", ["signed", "active", "completed"])
      .order("created_at", { ascending: false });
  }
  type C = {
    id: string;
    reference_code: string | null;
    customer_id: string;
    status: string;
    plan_type: string;
    total_cash_cents: number | null;
    monthly_cents: number | null;
    duration_months: number | null;
    duration_months_original?: number | null;
    permanence_months?: number | null;
    payment_state?: string | null;
    service_start_date?: string | null;
    signed_at: string | null;
    created_at: string;
    paused_at?: string | null;
    pause_reason?: string | null;
  };
  const contracts = (r.data ?? []) as C[];
  if (contracts.length === 0) return { rows: [], kpi: emptyKpi() };

  // Nombres de cliente
  const customerIds = Array.from(new Set(contracts.map((c) => c.customer_id)));
  const { data: cs } = await admin
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .in("id", customerIds);
  type CC = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  const nameMap = new Map(
    ((cs ?? []) as CC[]).map((c) => [
      c.id,
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "Sin nombre"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre",
    ]),
  );

  // Pagos del contrato — el "último cobro" es el contract_payment más
  // reciente de cualquier tipo. Las "cuotas cobradas" cuentan SOLO las
  // mensuales con concepto "Cuota mensual" y status validated/collected.
  const contractIds = contracts.map((c) => c.id);
  const { data: payments } = await admin
    .from("contract_payments")
    .select("contract_id, amount_cents, status, collected_at, created_at, concept")
    .in("contract_id", contractIds)
    .order("created_at", { ascending: false });
  type P = {
    contract_id: string;
    amount_cents: number;
    status: string;
    collected_at: string | null;
    created_at: string;
    concept: string;
  };
  const lastPaymentByContract = new Map<string, P>();
  const collectedMonthsByContract = new Map<string, number>();
  const depositCollectedByContract = new Map<string, number>();
  for (const p of (payments ?? []) as P[]) {
    if (!lastPaymentByContract.has(p.contract_id)) {
      lastPaymentByContract.set(p.contract_id, p);
    }
    const isCollected =
      p.status === "validated" || p.status === "collected_pending_validation";
    if (/^Cuota mensual/i.test(p.concept) && isCollected) {
      collectedMonthsByContract.set(
        p.contract_id,
        (collectedMonthsByContract.get(p.contract_id) ?? 0) + 1,
      );
    }
    if (/^Fianza/i.test(p.concept) && isCollected) {
      depositCollectedByContract.set(
        p.contract_id,
        (depositCollectedByContract.get(p.contract_id) ?? 0) + p.amount_cents,
      );
    }
  }

  // Mantenimientos asociados (count por status)
  const { data: mjobs } = await admin
    .from("maintenance_jobs")
    .select("contract_id, status")
    .in("contract_id", contractIds);
  type MJ = { contract_id: string; status: string };
  const maintCount = new Map<string, { pending: number; done: number }>();
  for (const j of ((mjobs ?? []) as MJ[])) {
    const cur = maintCount.get(j.contract_id) ?? { pending: 0, done: 0 };
    if (j.status === "completed") cur.done += 1;
    else if (j.status === "scheduled" || j.status === "in_progress") cur.pending += 1;
    maintCount.set(j.contract_id, cur);
  }

  const now = new Date();
  const rows: RentalRow[] = contracts.map((c) => {
    const startSrc = c.service_start_date ?? c.signed_at ?? c.created_at;
    const start = startSrc ? new Date(startSrc) : null;
    let endDateEst: Date | null = null;
    // Meses cobrados = nº de cuotas mensuales validadas/cobradas
    const monthsCollected = collectedMonthsByContract.get(c.id) ?? 0;
    const monthsElapsed: number = monthsCollected;
    let monthsLeft: number | null = null;
    let progressPct: number | null = null;
    if (start && c.duration_months) {
      endDateEst = new Date(start);
      endDateEst.setMonth(endDateEst.getMonth() + c.duration_months);
      monthsLeft = Math.max(0, c.duration_months - monthsCollected);
      progressPct = Math.min(
        100,
        Math.round((monthsCollected / c.duration_months) * 100),
      );
    }
    // Permanencia cumplida = ya cobramos al menos N cuotas (no por
    // tiempo transcurrido — si los recibos van retrasados, no cuenta).
    const permanenceDone =
      !c.permanence_months ||
      c.permanence_months <= 0 ||
      monthsCollected >= c.permanence_months;

    const lp = lastPaymentByContract.get(c.id) ?? null;
    const mc = maintCount.get(c.id) ?? { pending: 0, done: 0 };
    const isPaused = c.paused_at != null;

    let alert: RentalRow["alert"] = null;
    if (isPaused) alert = "paused";
    else if (monthsLeft != null && monthsLeft <= 0 && c.status === "active") alert = "overdue";
    else if (monthsLeft != null && monthsLeft > 0 && monthsLeft <= 3) alert = "expiring_soon";
    else if (lp && (lp.status === "rejected" || lp.status === "pending")) alert = "unpaid";

    return {
      id: c.id,
      reference_code: c.reference_code,
      customer_id: c.customer_id,
      customer_name: nameMap.get(c.customer_id) ?? "Cliente",
      status: c.status,
      is_paused: isPaused,
      paused_at: c.paused_at ?? null,
      pause_reason: c.pause_reason ?? null,
      monthly_cents: c.monthly_cents,
      total_cash_cents: c.total_cash_cents,
      duration_months: c.duration_months,
      duration_months_original: c.duration_months_original ?? null,
      permanence_months: c.permanence_months ?? null,
      payment_state: c.payment_state ?? null,
      start_date: start ? start.toISOString() : null,
      end_date_est: endDateEst ? endDateEst.toISOString() : null,
      months_elapsed: monthsElapsed,
      months_left: monthsLeft,
      progress_pct: progressPct,
      permanence_done: permanenceDone,
      deposit_collected_cents: depositCollectedByContract.get(c.id) ?? 0,
      last_payment_at: lp ? (lp.collected_at ?? lp.created_at) : null,
      last_payment_status: lp ? lp.status : null,
      last_payment_amount_cents: lp ? lp.amount_cents : null,
      maintenance_pending: mc.pending,
      maintenance_done: mc.done,
      alert,
    };
  });

  // KPIs
  const activeRows = rows.filter((r) => r.status === "active");
  const pausedRows = rows.filter((r) => r.is_paused);
  const mrrRows = activeRows.filter((r) => !r.is_paused);
  const kpi: RentalsDashboard["kpi"] = {
    active_count: activeRows.length,
    paused_count: pausedRows.length,
    mrr_cents: mrrRows.reduce((s, r) => s + (r.monthly_cents ?? 0), 0),
    expiring_soon: rows.filter((r) => r.alert === "expiring_soon").length,
    unpaid: rows.filter((r) => r.alert === "unpaid").length,
    permanence_done: activeRows.filter((r) => r.permanence_done).length,
  };

  return { rows, kpi };
}

function emptyKpi(): RentalsDashboard["kpi"] {
  return {
    active_count: 0,
    paused_count: 0,
    mrr_cents: 0,
    expiring_soon: 0,
    unpaid: 0,
    permanence_done: 0,
  };
}
