"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import type { ContractDetail, ContractListItem } from "./types";
import { notifyContractSigned } from "@/modules/notifications/notifier";
import { autoScheduleMaintenanceForContract } from "@/modules/maintenance/auto-schedule";

export async function listContracts(filters?: {
  status?: string;
  plan_type?: string;
  missing_financier?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ContractListItem[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  // Si no es admin/director y no tiene userIds visibles, devolvemos vacío.
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  const supabase = await createClient();
  const limit = Math.min(500, filters?.limit ?? 50);
  const offset = Math.max(0, filters?.offset ?? 0);
  // Query defensiva: financier_id se añadió en migración tardía. Si no
  // está en el cache de PostgREST, retry sin él.
  const FULL_COLS =
    "id, reference_code, status, customer_id, plan_type, total_cash_cents, monthly_cents, signed_at, created_at, financier_id";
  const BASE_COLS =
    "id, reference_code, status, customer_id, plan_type, total_cash_cents, monthly_cents, signed_at, created_at";
  async function runQuery(cols: string) {
    let q = supabase
      .from("contracts")
      .select(cols)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (visibleUserIds) q = q.in("created_by", visibleUserIds);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.plan_type) q = q.eq("plan_type", filters.plan_type);
    if (filters?.missing_financier && cols.includes("financier_id")) {
      q = q.eq("plan_type", "renting").is("financier_id", null);
    }
    return q;
  }
  let { data, error } = await runQuery(FULL_COLS);
  if (error && /financier_id|column .* does not exist/i.test(error.message ?? "")) {
    const retry = await runQuery(BASE_COLS);
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;

  const rows = ((data ?? []) as unknown) as Array<{
    id: string;
    reference_code: string | null;
    status: ContractListItem["status"];
    customer_id: string;
    plan_type: "cash" | "renting" | "rental";
    total_cash_cents: number | null;
    monthly_cents: number | null;
    signed_at: string | null;
    created_at: string;
    financier_id?: string | null;
  }>;
  if (rows.length === 0) return [];

  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
  const { data: cs } = await supabase
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
  return rows.map((r) => ({
    ...r,
    customer_name: nameMap.get(r.customer_id) ?? "Cliente",
    financier_id: r.financier_id ?? null,
  }));
}

export async function getContract(id: string): Promise<ContractDetail> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  const c = data as ContractDetail & { company_id?: string };
  // Backfill reference_code C-YYYY-NNNN si está vacío (one-shot por contrato)
  if (!c.reference_code && c.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const year = new Date(c.created_at).getFullYear();
      const yearPrefix = `C-${year}-`;
      const { data: last } = await admin
        .from("contracts")
        .select("reference_code")
        .eq("company_id", c.company_id)
        .like("reference_code", `${yearPrefix}%`)
        .order("reference_code", { ascending: false })
        .limit(1)
        .maybeSingle();
      let n = 1;
      const lastCode = (last as { reference_code: string | null } | null)?.reference_code;
      if (lastCode) {
        const m = lastCode.match(/-(\d+)$/);
        if (m) n = parseInt(m[1]!, 10) + 1;
      }
      const code = `${yearPrefix}${String(n).padStart(4, "0")}`;
      await admin.from("contracts").update({ reference_code: code }).eq("id", id);
      c.reference_code = code;
    } catch {
      /* fail-soft */
    }
  }
  return c;
}

export async function getContractItems(contractId: string) {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_items")
    .select("id, product_id, product_name_snapshot, quantity, unit_price_cents")
    .eq("contract_id", contractId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    product_id: string;
    product_name_snapshot: string;
    quantity: number;
    unit_price_cents: number;
  }>;
}

export async function getContractPayments(contractId: string) {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_payments")
    .select(
      "id, concept, amount_cents, method, moment, status, collected_at, validated_at, notes",
    )
    .eq("contract_id", contractId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    concept: string;
    amount_cents: number;
    method: string;
    moment: string;
    status: string;
    collected_at: string | null;
    validated_at: string | null;
    notes: string | null;
  }>;
}

/**
 * Crea un contrato desde una propuesta aceptada.
 * Copia items, calcula pagos básicos (1 pago contado por total) y deja
 * el contrato en pending_data si faltan datos del cliente.
 */
export async function createContractFromProposal(proposalId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");

  const { rateLimit } = await import("@/shared/lib/rate-limit");
  rateLimit(`contract_create:${session.user_id}`, 20, 60_000);

  const supabase = await createClient();

  // Idempotencia: si ya existe un contrato no eliminado generado a partir
  // de esta propuesta, redirigimos al existente en lugar de crear otro
  // (antes "Generar contrato" creaba duplicados como C-2026-0002).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supaCheck = supabase as any;
  const { data: existing } = await supaCheck
    .from("contracts")
    .select("id")
    .eq("source_proposal_id", proposalId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const existingId = (existing as { id: string } | null)?.id;
  if (existingId) {
    redirect(`/contratos/${existingId}` as never);
  }

  // Intentamos primero con los campos del overhaul (chosen_plan_type/
  // chosen_duration_months). Si la migración 20260503340000 no está
  // aplicada, retry con campos básicos para que el flujo no se rompa.
  let proposal: unknown = null;
  let pErr: { message?: string } | null = null;
  {
    // Pedimos también los campos de financiera (Fase 4). Si no están en el
    // cache caemos al subset legacy.
    const FIN_COLS =
      "id, status, customer_id, lead_id, total_cash_cents, monthly_renting_min_cents, monthly_rental_cents, chosen_plan_type, chosen_duration_months, financier_id, financier_payment_cents, financier_term_months, financier_coefficient, financier_residual_cents, financier_reserve_cents";
    const r = await supabase
      .from("proposals")
      .select(FIN_COLS)
      .eq("id", proposalId)
      .single();
    proposal = r.data;
    pErr = r.error as { message?: string } | null;
    if (pErr && /column .* does not exist|chosen_plan_type|chosen_duration_months|financier_/i.test(pErr.message ?? "")) {
      const r2 = await supabase
        .from("proposals")
        .select(
          "id, status, customer_id, lead_id, total_cash_cents, monthly_renting_min_cents, monthly_rental_cents, chosen_plan_type, chosen_duration_months",
        )
        .eq("id", proposalId)
        .single();
      proposal = r2.data
        ? {
            ...(r2.data as object),
            financier_id: null,
            financier_payment_cents: null,
            financier_term_months: null,
            financier_coefficient: null,
            financier_residual_cents: null,
            financier_reserve_cents: null,
          }
        : null;
      pErr = r2.error as { message?: string } | null;
    }
  }
  if (pErr) throw pErr;
  const p = proposal as {
    id: string;
    status: string;
    customer_id: string | null;
    lead_id: string | null;
    total_cash_cents: number | null;
    monthly_renting_min_cents: number | null;
    monthly_rental_cents: number | null;
    chosen_plan_type: "cash" | "rental" | "renting" | null;
    chosen_duration_months: number | null;
    financier_id: string | null;
    financier_payment_cents: number | null;
    financier_term_months: number | null;
    financier_coefficient: number | null;
    financier_residual_cents: number | null;
    financier_reserve_cents: number | null;
  };

  if (p.status !== "accepted") throw new Error("La propuesta debe estar aceptada");
  if (!p.customer_id) {
    throw new Error("La propuesta no tiene cliente; convierte el lead primero");
  }

  // Snapshot cliente
  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", p.customer_id)
    .single();
  if (!customer) throw new Error("Cliente no encontrado");
  const cust = customer as Record<string, unknown> & { tax_id: string | null };

  const has_provisional_data = !cust.tax_id;

  // Pending fields: comprobamos campos críticos del cliente para watermark PDF
  const pending: string[] = [];
  if (!cust.tax_id) pending.push("dni");
  // IBAN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supaAny = supabase as any;
  const { data: hasBank } = await supaAny
    .from("customer_bank_accounts")
    .select("id, is_validated, iban")
    .eq("customer_id", p.customer_id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  // IBAN se considera pendiente si no hay cuenta o si la única cuenta es
  // un placeholder ES00 (is_validated=false). En ambos casos el contrato
  // se podrá firmar pero queda marcado como pendiente de número de cuenta.
  const bankRow = hasBank as { is_validated: boolean | null; iban: string | null } | null;
  if (!bankRow || bankRow.is_validated === false) pending.push("iban");
  // Dirección
  const { data: hasAddr } = await supaAny
    .from("addresses")
    .select("id")
    .eq("customer_id", p.customer_id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!hasAddr) pending.push("address");

  // El plan elegido en la propuesta determina el plan del contrato. Si la
  // propuesta es vieja (sin chosen_plan_type) asumimos cash por compat.
  const planType = p.chosen_plan_type ?? "cash";

  // Snapshot cláusulas del PLAN ELEGIDO
  let { data: tpls } = await supaAny
    .from("contract_clause_templates")
    .select("title, body, display_order")
    .eq("company_id", session.company_id)
    .eq("plan_type", planType)
    .eq("is_active", true)
    .order("display_order");
  if (!tpls || (tpls as Array<unknown>).length === 0) {
    await supaAny.rpc("seed_default_clauses", { p_company_id: session.company_id });
    const r = await supaAny
      .from("contract_clause_templates")
      .select("title, body, display_order")
      .eq("company_id", session.company_id)
      .eq("plan_type", planType)
      .eq("is_active", true)
      .order("display_order");
    tpls = r.data;
  }
  const clausesSnapshot = ((tpls ?? []) as Array<{
    title: string;
    body: string;
    display_order: number;
  }>).map((t) => ({ title: t.title, body: t.body, display_order: t.display_order }));

  // Importes según plan
  const totalCashCents = planType === "cash" ? p.total_cash_cents : null;
  const monthlyCents =
    planType === "rental"
      ? p.monthly_rental_cents
      : planType === "renting"
        ? p.monthly_renting_min_cents
        : null;
  const durationMonths = p.chosen_duration_months;

  // Generar reference_code C-YYYY-NNNN único por empresa+año
  const year = new Date().getFullYear();
  const yearPrefix = `C-${year}-`;
  const { data: lastCoded } = await supaAny
    .from("contracts")
    .select("reference_code")
    .eq("company_id", session.company_id)
    .like("reference_code", `${yearPrefix}%`)
    .order("reference_code", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNum = 1;
  const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
  if (lastCode) {
    const m = lastCode.match(/-(\d+)$/);
    if (m) nextNum = parseInt(m[1]!, 10) + 1;
  }
  const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

  // Crear contract — defensivo ante columnas opcionales (snapshots,
  // pending_fields) que pueden no estar en producción.
  const fullContractPayload: Record<string, unknown> = {
    company_id: session.company_id,
    customer_id: p.customer_id,
    source_proposal_id: p.id,
    reference_code: referenceCode,
    plan_type: planType,
    duration_months: durationMonths,
    permanence_months: planType === "rental" ? durationMonths : null,
    total_cash_cents: totalCashCents,
    monthly_cents: monthlyCents,
    status: has_provisional_data ? "pending_data" : "pending_signature",
    has_provisional_data,
    customer_snapshot: cust,
    clauses_snapshot: clausesSnapshot,
    pending_fields: pending,
    created_by: session.user_id,
    // Snapshot de financiera (Fase 4). Si no es renting o no hay
    // financier_id, todo queda en null.
    financier_id: p.financier_id ?? null,
    financier_payment_cents: p.financier_payment_cents ?? null,
    financier_term_months: p.financier_term_months ?? null,
    financier_coefficient: p.financier_coefficient ?? null,
    financier_residual_cents: p.financier_residual_cents ?? null,
    financier_reserve_cents: p.financier_reserve_cents ?? null,
  };
  let createdRow: { id: string } | null = null;
  {
    const r = await supabase
      .from("contracts")
      .insert(fullContractPayload as never)
      .select("id")
      .single();
    const cErr = r.error as { message?: string } | null;
    if (cErr && /column .* does not exist|has_provisional_data|customer_snapshot|clauses_snapshot|pending_fields|source_proposal_id|financier_/i.test(cErr.message ?? "")) {
      // Retry con payload mínimo (sin snapshots ni financier_*).
      const minimal: Record<string, unknown> = {
        company_id: session.company_id,
        customer_id: p.customer_id,
        reference_code: referenceCode,
        plan_type: planType,
        duration_months: durationMonths,
        permanence_months: planType === "rental" ? durationMonths : null,
        total_cash_cents: totalCashCents,
        monthly_cents: monthlyCents,
        status: has_provisional_data ? "pending_data" : "pending_signature",
        created_by: session.user_id,
      };
      const r2 = await supabase
        .from("contracts")
        .insert(minimal as never)
        .select("id")
        .single();
      if (r2.error) throw r2.error;
      createdRow = r2.data as { id: string };
    } else if (cErr) {
      throw cErr;
    } else {
      createdRow = r.data as { id: string };
    }
  }
  if (!createdRow) throw new Error("No se pudo crear el contrato");
  const contractId = createdRow.id;

  // Copiar items desde proposal_items con TODA la configuración de la propuesta.
  // Mismo patrón defensivo que arriba: si la migración 20260503340000 no
  // está aplicada en BD, retry con columnas básicas.
  let items: unknown[] | null = null;
  {
    const r = await supabase
      .from("proposal_items")
      .select(
        "product_id, product_name_snapshot, quantity, unit_price_cash_cents, display_order, installation_included, installation_price_cents, maintenance_included, maintenance_until_date, maintenance_price_cents, maintenance_periodicity_months, deposit_cents, charge_first_payment_now",
      )
      .eq("proposal_id", p.id)
      .order("display_order");
    const itemsErr = r.error as { message?: string } | null;
    if (itemsErr && /column .* does not exist|installation_included|maintenance_included|deposit_cents|charge_first_payment_now/i.test(itemsErr.message ?? "")) {
      const r2 = await supabase
        .from("proposal_items")
        .select(
          "product_id, product_name_snapshot, quantity, unit_price_cash_cents, display_order",
        )
        .eq("proposal_id", p.id)
        .order("display_order");
      // Hidratar con valores por defecto (instalación incluida, sin mantenimiento)
      items = ((r2.data ?? []) as Array<Record<string, unknown>>).map((it) => ({
        ...it,
        installation_included: true,
        installation_price_cents: null,
        maintenance_included: false,
        maintenance_until_date: null,
        maintenance_price_cents: null,
        maintenance_periodicity_months: null,
        deposit_cents: null,
        charge_first_payment_now: false,
      }));
    } else {
      items = r.data as unknown[] | null;
    }
  }
  type PI = {
    product_id: string;
    product_name_snapshot: string;
    quantity: number;
    unit_price_cash_cents: number | null;
    display_order: number;
    installation_included: boolean;
    installation_price_cents: number | null;
    maintenance_included: boolean;
    maintenance_until_date: string | null;
    maintenance_price_cents: number | null;
    maintenance_periodicity_months: number | null;
    deposit_cents: number | null;
    charge_first_payment_now: boolean;
  };
  const ps = (items ?? []) as PI[];

  if (ps.length > 0) {
    const ids = ps.map((i) => i.product_id);
    const { data: prods } = await supabase.from("products").select("id, kind").in("id", ids);
    const kinds = new Map(
      ((prods ?? []) as { id: string; kind: string }[]).map((p) => [p.id, p.kind]),
    );
    const rows = ps.map((it, idx) => ({
      contract_id: contractId,
      company_id: session.company_id!,
      product_id: it.product_id,
      quantity: it.quantity,
      product_name_snapshot: it.product_name_snapshot,
      product_kind_snapshot: kinds.get(it.product_id) ?? "equipment",
      unit_price_cents: it.unit_price_cash_cents ?? 0,
      display_order: idx,
    }));
    await supabase.from("contract_items").insert(rows as never);

    // Propagar flags de mantenimiento al CONTRATO (no se hizo en el insert
    // inicial porque ps se carga después). Agregamos: maintenance_included
    // = true si CUALQUIER item lo lleva; periodicity = del primer item con
    // mantenimiento; months_included = duración hasta maintenance_until_date
    // (en meses) si está informada, fallback a duration_months.
    const itemWithMaint = ps.find((it) => it.maintenance_included);
    if (itemWithMaint) {
      let monthsIncluded: number | null = null;
      if (itemWithMaint.maintenance_until_date) {
        const until = new Date(itemWithMaint.maintenance_until_date);
        const now = new Date();
        monthsIncluded = Math.max(
          1,
          Math.round(
            (until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
          ),
        );
      }
      const maintenanceUpdate: Record<string, unknown> = {
        maintenance_included: true,
        maintenance_periodicity_months:
          itemWithMaint.maintenance_periodicity_months ?? 12,
        maintenance_months_included: monthsIncluded ?? durationMonths ?? 12,
      };
      try {
        await supabase
          .from("contracts")
          .update(maintenanceUpdate)
          .eq("id", contractId);
      } catch (e) {
        console.error(
          "[createContractFromProposal] update maintenance flags falló:",
          e,
        );
      }
    }
  }

  // === Generar pagos del contrato según plan ===
  const payments: Array<{
    concept: string;
    amount_cents: number;
    method: string;
    moment: string;
  }> = [];

  // 1) Plan contado: pago único total
  if (planType === "cash" && totalCashCents && totalCashCents > 0) {
    payments.push({
      concept: "Pago contado",
      amount_cents: totalCashCents,
      method: "transfer",
      moment: "on_signature",
    });
  }

  // 2) Fianzas (solo alquiler)
  if (planType === "rental") {
    for (const it of ps) {
      if (it.deposit_cents && it.deposit_cents > 0) {
        payments.push({
          concept: `Fianza · ${it.product_name_snapshot}`,
          amount_cents: it.deposit_cents * it.quantity,
          method: "transfer",
          moment: "on_signature",
        });
      }
    }
    // 3) 1ª cuota cobrada al firmar (si se marcó en propuesta)
    for (const it of ps) {
      if (it.charge_first_payment_now && it.unit_price_cash_cents) {
        payments.push({
          concept: `1ª cuota · ${it.product_name_snapshot}`,
          amount_cents: (it.unit_price_cash_cents ?? 0) * it.quantity,
          method: "transfer",
          moment: "on_signature",
        });
      }
    }
  }

  // 4) Instalación si NO está incluida
  for (const it of ps) {
    if (
      !it.installation_included &&
      it.installation_price_cents &&
      it.installation_price_cents > 0
    ) {
      payments.push({
        concept: `Instalación · ${it.product_name_snapshot}`,
        amount_cents: it.installation_price_cents * it.quantity,
        method: "cash",
        moment: "on_installation",
      });
    }
  }

  if (payments.length > 0) {
    // Idempotencia (decisión 2026-05-19): si esta action se ejecuta dos
    // veces para el mismo contract_id (race condition, doble click en
    // "Convertir propuesta a contrato"), no debe duplicar contract_payments.
    // Comprobamos si ya existen pagos antes de insertar.
    const { count: existingPayments } = await supabase
      .from("contract_payments")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId);
    if ((existingPayments ?? 0) === 0) {
      await supabase.from("contract_payments").insert(
        payments.map((pay) => ({
          contract_id: contractId,
          company_id: session.company_id,
          concept: pay.concept,
          amount_cents: pay.amount_cents,
          method: pay.method,
          moment: pay.moment,
          status: "pending",
        })) as never,
      );
    } else {
      console.warn(
        `[createContractFromProposal] contract ${contractId} ya tiene ${existingPayments} contract_payments — skip insert para evitar duplicados.`,
      );
    }
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: contractId,
    kind: "contract.created",
    payload: { from_proposal: p.id },
    actor_user_id: session.user_id,
  } as never);

  revalidatePath("/contratos");
  redirect(`/contratos/${contractId}` as never);
}

/**
 * Limpia contract_payments duplicados de un contrato. Mismo concept +
 * mismo amount_cents + status=pending → deja solo el más antiguo.
 * Solo admin / director comercial.
 */
export async function cleanupDuplicateContractPaymentsAction(
  contractId: string,
): Promise<
  | { ok: true; removed: number }
  | { ok: false; error: string }
> {
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
        error: "Solo admin / dirección comercial puede limpiar duplicados.",
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: pays } = await admin
      .from("contract_payments")
      .select("id, concept, amount_cents, status, created_at")
      .eq("contract_id", contractId)
      .order("created_at", { ascending: true });
    type P = {
      id: string;
      concept: string;
      amount_cents: number;
      status: string;
      created_at: string;
    };
    const list = (pays ?? []) as P[];
    // Agrupar por (concept normalizado + amount). Mantenemos solo el
    // primero pending; si hay algún status distinto a pending, NO
    // borramos nada de ese grupo (porque ya hay actividad real).
    const groups = new Map<string, P[]>();
    for (const p of list) {
      const key = `${p.concept.trim().toLowerCase()}::${p.amount_cents}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    const toDelete: string[] = [];
    for (const arr of groups.values()) {
      if (arr.length <= 1) continue;
      // Si alguno NO es pending → no tocar el grupo (riesgo de borrar
      // pagos ya cobrados/validados).
      if (arr.some((p) => p.status !== "pending")) continue;
      // Borrar todos menos el primero
      for (let i = 1; i < arr.length; i++) toDelete.push(arr[i]!.id);
    }
    if (toDelete.length === 0) {
      return { ok: true, removed: 0 };
    }
    const { error } = await admin
      .from("contract_payments")
      .delete()
      .in("id", toDelete);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/contratos/${contractId}`);
    revalidatePath("/wallet");
    return { ok: true, removed: toDelete.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function markContractSigned(id: string) {
  const session = await requireSession();
  // Admin client: la policy contracts_update_by_scope sólo permite UPDATE
  // si status IN (draft, pending_data, pending_signature). Si por race
  // condition o policy de scope el comercial no tiene permiso, el UPDATE
  // silenciaría y NO se firmaría el contrato. Mismo patrón que ya hemos
  // arreglado en otras acciones.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Guard: contrato debe tener al menos un item antes de firmar (audit
  // final 2026-05-10). Antes se firmaba un contrato vacío y el flujo
  // posterior (sales_records, instalación) fallaba.
  const { count: itemsCount } = await admin
    .from("contract_items")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", id);
  if ((itemsCount ?? 0) === 0) {
    throw new Error(
      "El contrato no tiene productos. Añade al menos un equipo antes de firmar.",
    );
  }
  // Guard adicional: si el contrato es de domiciliación y el IBAN es
  // placeholder ES00, NO firmar. Antes se permitía y luego GoCardless
  // fallaba al intentar cobrar.
  // (la detección ES00 ya existe abajo — la reutilizamos para BLOQUEAR
  // el firmado si el plan es renting/rental)
  const { data: ctxValidate } = await admin
    .from("contracts")
    .select("customer_id, chosen_plan_type")
    .eq("id", id)
    .maybeSingle();
  const cv = ctxValidate as
    | { customer_id: string | null; chosen_plan_type: string | null }
    | null;
  if (
    cv?.customer_id &&
    (cv.chosen_plan_type === "rental" || cv.chosen_plan_type === "renting")
  ) {
    const { data: bk } = await admin
      .from("customer_bank_accounts")
      .select("iban")
      .eq("customer_id", cv.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const iban = (bk as { iban: string | null } | null)?.iban ?? null;
    if (!iban) {
      throw new Error(
        "Falta IBAN del cliente para domiciliar la cuota. Añade una cuenta bancaria antes de firmar.",
      );
    }
    // ES00 sigue permitiéndose como pendiente (decisión 2026-05-08): el
    // contrato se firma con flag has_provisional_data y se completa
    // luego. Validar formato básico ES + 22 chars.
    if (!/^ES\d{2}[\dA-Z]{20}$/i.test(iban.replace(/\s+/g, ""))) {
      throw new Error(
        "El IBAN del cliente no tiene formato español válido (ES + 22 caracteres).",
      );
    }
  }

  // Detectar si IBAN del cliente es ES00 (placeholder pendiente).
  // En ese caso marcamos has_provisional_data + pending_fields para
  // que se vea claramente que el contrato está firmado pero pendiente
  // de IBAN real (decisión usuario 2026-05-08).
  const { data: ctx } = await admin
    .from("contracts")
    .select("customer_id, chosen_plan_type")
    .eq("id", id)
    .maybeSingle();
  const ctxRow = ctx as
    | { customer_id: string | null; chosen_plan_type: string | null }
    | null;
  let provisionalIban = false;
  if (
    ctxRow?.customer_id &&
    (ctxRow.chosen_plan_type === "rental" || ctxRow.chosen_plan_type === "renting")
  ) {
    const { data: bk } = await admin
      .from("customer_bank_accounts")
      .select("iban, is_validated")
      .eq("customer_id", ctxRow.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = bk as { iban: string | null; is_validated: boolean | null } | null;
    if (b?.iban && (/^ES00/i.test(b.iban) || !b.is_validated)) {
      provisionalIban = true;
    }
  }

  // Decisión usuario 2026-05-19: si falta IBAN real (ES00 o no validado),
  // el contrato NO se firma "limpio" — pasa a 'pending_data'. Legalmente
  // un contrato firmado debe estar completo. Una vez el admin valide el
  // IBAN real, se promueve a 'signed' (ver validateContractIbanAction).
  const updates: Record<string, unknown> = {
    signed_at: new Date().toISOString(),
    signed_by_user_id: session.user_id,
  };
  if (provisionalIban) {
    updates.status = "pending_data";
    updates.has_provisional_data = true;
    updates.pending_fields = ["iban"];
  } else {
    updates.status = "signed";
    updates.has_provisional_data = false;
    updates.pending_fields = [];
  }

  const r = await admin.from("contracts").update(updates).eq("id", id);
  if (r.error) throw new Error(r.error.message);

  // Cuando se firma el contrato, el lead origen (si existía) ya cumplió
  // su ciclo: lo soft-deleteamos para que desaparezca de /leads.
  // El cliente sigue visible en /clientes con todo su historial.
  try {
    const { data: contractRow } = await supabase
      .from("contracts")
      .select("customer_id")
      .eq("id", id)
      .maybeSingle();
    const customerId = (contractRow as { customer_id: string | null } | null)?.customer_id;
    if (customerId) {
      const { data: cust } = await supabase
        .from("customers")
        .select("source_lead_id")
        .eq("id", customerId)
        .maybeSingle();
      const sourceLeadId = (cust as { source_lead_id: string | null } | null)?.source_lead_id;
      if (sourceLeadId) {
        await supabase
          .from("leads")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", sourceLeadId);
      }
    }
  } catch {
    /* fail-soft */
  }

  // Crear automáticamente wallet entries para todos los contract_payments
  // pendientes que no tengan ya una wallet entry asociada (decisión: al
  // firmar el contrato, los pagos previstos se materializan en Wallet).
  const { data: payments } = await supabase
    .from("contract_payments")
    .select("id, concept, amount_cents, method, wallet_entry_id, contract_id")
    .eq("contract_id", id)
    .eq("status", "pending")
    .is("wallet_entry_id", null);

  type CP = {
    id: string;
    concept: string;
    amount_cents: number;
    method: string;
    wallet_entry_id: string | null;
    contract_id: string;
  };
  const list = (payments ?? []) as CP[];
  for (const p of list) {
    const { data: created } = await supabase
      .from("wallet_entries")
      .insert({
        company_id: session.company_id!,
        contract_id: p.contract_id,
        contract_payment_id: p.id,
        concept: p.concept,
        amount_cents: p.amount_cents,
        method: p.method,
        status: "pending",
      })
      .select("id")
      .single();
    if (created) {
      await supabase
        .from("contract_payments")
        .update({ wallet_entry_id: (created as { id: string }).id })
        .eq("id", p.id);
    }
  }

  // Generar mantenimientos automáticos según frecuencia del contrato
  let scheduledCount = 0;
  try {
    const { scheduleMaintenanceForContract } = await import("./maintenance-scheduler");
    scheduledCount = await scheduleMaintenanceForContract(id);
  } catch {
    /* fail-soft: no bloquea la firma si la generación falla */
  }

  // AUTO-CREAR INSTALACIÓN PENDIENTE: si todavía no hay instalación
  // para este contrato, la creamos en estado 'unscheduled' con los
  // items copiados. Así el comercial NO tiene que pulsar "Generar
  // instalación" — la instalación aparece directamente en /instalaciones
  // y se podrá programar fecha+instalador desde ahí.
  let installationCreated = false;
  try {
    const { count: instCount } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", id)
      .is("deleted_at", null);
    if ((instCount ?? 0) === 0) {
      // Generar reference_code I-YYYY-NNNN
      const year = new Date().getFullYear();
      const yearPrefix = `I-${year}-`;
      const { data: lastCoded } = await admin
        .from("installations")
        .select("reference_code")
        .eq("company_id", session.company_id!)
        .like("reference_code", `${yearPrefix}%`)
        .order("reference_code", { ascending: false })
        .limit(1)
        .maybeSingle();
      let nextNum = 1;
      const lastCode = (lastCoded as { reference_code: string | null } | null)?.reference_code;
      if (lastCode) {
        const m = lastCode.match(/-(\d+)$/);
        if (m) nextNum = parseInt(m[1]!, 10) + 1;
      }
      const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

      const { data: contractFull } = await admin
        .from("contracts")
        .select("customer_id")
        .eq("id", id)
        .single();
      const cFull = contractFull as { customer_id: string | null } | null;

      // Crear la instalación SIN agendar. La firma del contrato NO
      // programa fecha — eso lo hace nivel 1/2 después, usando las
      // preferencias del cliente (preferred_install_dates/slot) que ya
      // quedaron guardadas en el contrato como sugerencia.
      const { data: instCreated } = await admin
        .from("installations")
        .insert({
          company_id: session.company_id!,
          kind: "normal",
          status: "unscheduled",
          scheduled_at: null,
          contract_id: id,
          customer_id: cFull?.customer_id ?? null,
          reference_code: referenceCode,
          created_by: session.user_id,
        })
        .select("id")
        .single();
      const newInstId = (instCreated as { id: string } | null)?.id;
      if (newInstId) {
        // Copiar items del contrato. Si falla la query o no hay items,
        // creamos un evento de alerta para que admin lo vea — no
        // queremos una instalación huérfana sin productos que confunda
        // al técnico cuando vaya a instalar.
        const { data: items, error: itemsErr } = await admin
          .from("contract_items")
          .select("product_id, quantity, display_order, notes")
          .eq("contract_id", id);
        if (itemsErr) {
          console.error("[markContractSigned] contract_items select:", itemsErr);
          try {
            await admin.from("events").insert({
              company_id: session.company_id!,
              subject_type: "installation",
              subject_id: newInstId,
              kind: "installation.items_missing",
              payload: {
                error: itemsErr.message,
                reason: "select failed",
              },
              actor_user_id: session.user_id,
            });
          } catch {
            /* fail-soft del log */
          }
        }
        const list = (items ?? []) as Array<{
          product_id: string;
          quantity: number;
          display_order: number;
          notes: string | null;
        }>;
        if (list.length > 0) {
          const insIt = await admin.from("installation_items").insert(
            list.map((it) => ({
              installation_id: newInstId,
              company_id: session.company_id!,
              product_id: it.product_id,
              quantity: it.quantity,
              display_order: it.display_order,
              notes: it.notes,
            })),
          );
          if (insIt.error) {
            console.error("[markContractSigned] installation_items insert:", insIt.error);
            try {
              await admin.from("events").insert({
                company_id: session.company_id!,
                subject_type: "installation",
                subject_id: newInstId,
                kind: "installation.items_missing",
                payload: {
                  error: insIt.error.message,
                  reason: "insert failed",
                  contract_items_count: list.length,
                },
                actor_user_id: session.user_id,
              });
            } catch {
              /* fail-soft */
            }
          }
        } else if (!itemsErr) {
          // El contrato no tenía items — situación rara, registrar
          try {
            await admin.from("events").insert({
              company_id: session.company_id!,
              subject_type: "installation",
              subject_id: newInstId,
              kind: "installation.items_missing",
              payload: { reason: "contract had no items" },
              actor_user_id: session.user_id,
            });
          } catch {
            /* fail-soft */
          }
        }

        // NO se inserta evento en agenda al firmar. La agenda se rellena
        // cuando nivel 1/2 agende la instalación con fecha concreta.

        installationCreated = true;
      }
    }
  } catch {
    /* fail-soft: la firma no se rompe por esto */
  }

  // Reservar stock en almacén principal para todos los items del contrato.
  // Fail-soft: si falla, no rompe la firma (puede ser por falta de almacén
  // o tabla aún no migrada).
  try {
    const { reserveStockForContractAction } = await import(
      "@/modules/warehouses/reservation-actions"
    );
    const r = await reserveStockForContractAction(id);
    if (!r.ok && r.error) {
      console.warn("[markContractSigned] reservas no creadas:", r.error);
    }
  } catch (e) {
    console.error("[markContractSigned] reserveStock falló:", e);
  }

  // === Sales record + puntos ==============================================
  // Al firmar el contrato:
  //  1. Insertamos sales_records (uno por cada item) para que el dashboard
  //     y los objetivos vean la venta.
  //  2. Otorgamos puntos al comercial (assigned_user_id del contrato) y
  //     al TMK (origen del lead) según points_settings de la empresa.
  // Fail-soft: si algo falla NO se rompe la firma.
  try {
    // Query defensiva: `assigned_user_id` y `financier_payment_cents` se
    // añadieron en migraciones tardías. Si schema cache no está al día,
    // reintentamos con el subset mínimo.
    const BASE_COLS =
      "id, customer_id, plan_type, total_cash_cents, monthly_cents, duration_months";
    let { data: contractFull, error: cfErr } = await admin
      .from("contracts")
      .select(`${BASE_COLS}, assigned_user_id, financier_payment_cents`)
      .eq("id", id)
      .single();
    if (cfErr && /column .* does not exist/i.test(cfErr.message ?? "")) {
      const retry = await admin
        .from("contracts")
        .select(BASE_COLS)
        .eq("id", id)
        .single();
      contractFull = retry.data;
      cfErr = retry.error;
    }
    if (cfErr) throw new Error(cfErr.message);
    const cf = contractFull as {
      id: string;
      customer_id: string | null;
      plan_type: "cash" | "rental" | "renting";
      total_cash_cents: number | null;
      monthly_cents: number | null;
      duration_months: number | null;
      assigned_user_id?: string | null;
      financier_payment_cents?: number | null;
    };

    // TMK origen: si el cliente vino de un lead con origin_tmk_user_id
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

    // Importe total — depende del tipo de venta (decisión 2026-05-18):
    //   cash    → total_cash_cents
    //   renting → lo que paga la financiera (financier_payment_cents, ya
    //             descontado el coeficiente). Fallback: cuota×meses si aún
    //             no hay financiera asignada (se ajustará en el reconcile).
    //   rental  → SOLO una cuota mensual (baja libre, nunca × duración).
    let totalCents = 0;
    if (cf.plan_type === "cash") {
      totalCents = cf.total_cash_cents ?? 0;
    } else if (cf.plan_type === "renting") {
      totalCents =
        cf.financier_payment_cents ??
        (cf.monthly_cents ?? 0) * (cf.duration_months ?? 0);
    } else {
      totalCents = cf.monthly_cents ?? 0;
    }

    // Items para crear un sales_record por cada uno
    const { data: contractItems } = await admin
      .from("contract_items")
      .select("id, product_id, quantity")
      .eq("contract_id", id);
    const items = ((contractItems ?? []) as Array<{
      id: string;
      product_id: string;
      quantity: number;
    }>);

    const periodYear = new Date().getFullYear();
    const periodMonth = new Date().getMonth() + 1;

    // Si no hay items (raro), creamos 1 sales_record genérico para que
    // el contrato cuente al menos como 1 unidad.
    const recordRows = (items.length > 0 ? items : [null]).map((it) => ({
      company_id: session.company_id!,
      contract_id: id,
      contract_item_id: it?.id ?? null,
      sales_user_id: cf.assigned_user_id ?? null,
      tmk_user_id: tmkUserId,
      installer_user_id: null,
      plan_type: cf.plan_type,
      total_cents:
        items.length > 0
          ? Math.round(totalCents / items.length) // reparto simple
          : totalCents,
      monthly_cents: cf.monthly_cents,
      duration_months: cf.duration_months,
      period_year: periodYear,
      period_month: periodMonth,
    }));
    // Antes el INSERT no comprobaba `error` y, si fallaba (enum, FK,
    // tipos…), el dashboard de objetivos quedaba en 0 sin avisar. Ahora
    // logueamos el error y, si falla, lanzamos un reintento usando el
    // reconcile helper (idempotente). Si tampoco va, el cron diario lo
    // arreglará por la mañana → ya no hace falta el botón manual.
    const { error: srErr } = await admin
      .from("sales_records")
      .insert(recordRows);
    if (srErr) {
      console.error(
        "[markContractSigned] sales_records INSERT failed:",
        srErr.message,
        "rows:",
        JSON.stringify(recordRows),
      );
      try {
        const { reconcileSalesRecordsForCompany } = await import(
          "@/modules/sales/reconcile"
        );
        const rec = await reconcileSalesRecordsForCompany(
          admin,
          session.company_id!,
          { force: false },
        );
        console.warn(
          "[markContractSigned] reconcile fallback:",
          `repaired=${rec.contracts_with_missing_records} inserted=${rec.records_inserted} errors=${rec.errors.length}`,
        );
      } catch (e) {
        console.error("[markContractSigned] reconcile fallback failed:", e);
      }
    }

    // PUNTOS: decisión usuario 2026-05-10 — los puntos por la venta NO
    // se otorgan al firmar el contrato. Quedan "pendientes" y se
    // entregan cuando se completa la instalación (cierre real del
    // ciclo). Aquí solo registramos el sales_record para que aparezca
    // en dashboard de objetivos. Si el contrato se cancela antes de
    // instalar, los puntos nunca llegan. Cuando se instale, el hook
    // awardSalesBundleOnInstall() dentro de completeInstallation hará
    // los cálculos completos usando contract.assigned_user_id (sales),
    // tmk_user_id (TMK split), items y points_settings.
  } catch (e) {
    console.error("[markContractSigned] sales_record/points falló:", e);
  }
  // ========================================================================

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "contract",
    subject_id: id,
    kind: "contract.signed",
    payload: {
      wallet_entries_created: list.length,
      maintenance_jobs_scheduled: scheduledCount,
      installation_auto_created: installationCreated,
    },
    actor_user_id: session.user_id,
  });

  // Notificar a admin + directores
  const { data: cref } = await supabase
    .from("contracts")
    .select("reference_code")
    .eq("id", id)
    .single();
  await notifyContractSigned(
    session.company_id!,
    id,
    (cref as { reference_code: string | null } | null)?.reference_code ?? null,
  );

  // Auto-envío email bienvenida al cliente con PDF del contrato adjunto.
  // Fail-soft: si el email falla, NO bloquea la firma (la firma ya está
  // hecha y registrada en BD).
  try {
    const { sendContractByEmailAction } = await import(
      "@/modules/mailing/send-document-actions"
    );
    await sendContractByEmailAction(id);
  } catch (e) {
    console.error("[markContractSigned] auto-email bienvenida falló:", e);
  }

  revalidatePath(`/contratos/${id}`);
  revalidatePath("/contratos");
  revalidatePath("/wallet");
  revalidatePath("/instalaciones");
  revalidatePath("/mantenimientos");
  revalidatePath("/dashboard");
  revalidatePath("/agenda");
}

// =============================================================================
// Validación contrato (firma financiera) + Cancelación
// =============================================================================

export type ContractActionResult = { ok: true } | { ok: false; error: string };

/**
 * Marca el contrato como validado. Se usa típicamente cuando la
 * financiera confirma OK del renting (o cuando el admin comprueba que
 * todo está en regla). A partir de aquí el comercial cuenta la venta.
 * Solo admin / director comercial.
 */
/**
 * Promueve un contrato de 'pending_data' a 'signed' cuando se ha resuelto
 * el dato pendiente (típicamente IBAN ES00 → IBAN real). Re-comprueba que
 * el IBAN actual del cliente es válido y no ES00.
 */
export async function promoteContractToSignedAction(
  id: string,
): Promise<ContractActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("commercial_director")
    ) {
      return { ok: false, error: "Solo admin o director comercial" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("contracts")
      .select("id, status, company_id, customer_id, plan_type")
      .eq("id", id)
      .maybeSingle();
    const c = row as
      | {
          id: string;
          status: string;
          company_id: string;
          customer_id: string | null;
          plan_type: string;
        }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (c.status !== "pending_data") {
      return {
        ok: false,
        error: `El contrato no está pendiente de datos (estado actual: ${c.status})`,
      };
    }

    // Re-comprobar IBAN si aplica (rental/renting)
    if (
      c.customer_id &&
      (c.plan_type === "rental" || c.plan_type === "renting")
    ) {
      const { data: bk } = await admin
        .from("customer_bank_accounts")
        .select("id, iban")
        .eq("customer_id", c.customer_id)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      const iban = (bk as { id: string; iban: string | null } | null)?.iban ?? null;
      if (!iban) {
        return {
          ok: false,
          error: "El cliente sigue sin IBAN. Añade uno antes de promover.",
        };
      }
      const clean = iban.replace(/\s+/g, "").toUpperCase();
      if (/^ES00/.test(clean)) {
        return {
          ok: false,
          error: "El IBAN sigue siendo ES00 (placeholder). Cámbialo por el real.",
        };
      }
      if (!/^ES\d{2}[\dA-Z]{20}$/.test(clean)) {
        return { ok: false, error: "Formato IBAN inválido (ES + 22 caracteres)." };
      }
      // Marcar IBAN como validado
      try {
        await admin
          .from("customer_bank_accounts")
          .update({ is_validated: true, validated_at: new Date().toISOString() })
          .eq("id", (bk as { id: string }).id);
      } catch (e) {
        console.error("[promoteContract] mark IBAN validated failed:", e);
      }
    }

    const r = await admin
      .from("contracts")
      .update({
        status: "signed",
        has_provisional_data: false,
        pending_fields: [],
      })
      .eq("id", id);
    if (r.error) return { ok: false, error: r.error.message };

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: id,
      kind: "contract.promoted_to_signed",
      payload: { from: "pending_data" },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/contratos/${id}`);
    revalidatePath("/contratos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function validateContractAction(id: string): Promise<ContractActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin") &&
      !session.roles.includes("commercial_director")
    ) {
      return { ok: false, error: "Solo admin o director comercial puede validar" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("contracts")
      .select("id, status, company_id")
      .eq("id", id)
      .maybeSingle();
    const c = row as { id: string; status: string; company_id: string } | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== session.company_id) return { ok: false, error: "Otra empresa" };
    if (!["signed", "active"].includes(c.status)) {
      return {
        ok: false,
        error: `El contrato debe estar firmado para validar (estado: ${c.status})`,
      };
    }
    const r = await admin
      .from("contracts")
      .update({
        validated_at: new Date().toISOString(),
        validated_by_user_id: session.user_id,
      })
      .eq("id", id);
    if (r.error) return { ok: false, error: r.error.message };
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: id,
      kind: "contract.validated",
      payload: {},
      actor_user_id: session.user_id,
    });
    revalidatePath(`/contratos/${id}`);
    revalidatePath("/contratos");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[validateContract]", e);
    return { ok: false, error: msg };
  }
}

/**
 * Cancela un contrato. Solo permitido si NO se ha firmado todavía o si
 * se ha firmado pero NO hay instalación creada. Si ya hay instalación,
 * hay que cancelar la instalación primero.
 */
export async function cancelContractAction(
  id: string,
  reason: string,
): Promise<ContractActionResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin puede cancelar contratos" };
    }
    if (!reason.trim()) return { ok: false, error: "Indica el motivo de cancelación" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("contracts")
      .select("id, status, company_id, signed_at")
      .eq("id", id)
      .maybeSingle();
    const c = row as
      | { id: string; status: string; company_id: string; signed_at: string | null }
      | null;
    if (!c) return { ok: false, error: "Contrato no encontrado" };
    if (c.company_id !== session.company_id) return { ok: false, error: "Otra empresa" };

    // Verificar que no haya instalación con status distinto de "scheduled"/"unscheduled"
    const { data: insts } = await admin
      .from("installations")
      .select("id, status")
      .eq("contract_id", id)
      .is("deleted_at", null);
    const installs = ((insts as Array<{ id: string; status: string }> | null) ?? []);
    const blockedByInstall = installs.some((i) =>
      ["in_progress", "completed"].includes(i.status),
    );
    if (blockedByInstall) {
      return {
        ok: false,
        error:
          "No se puede cancelar: ya hay instalación en curso o completada. Cancela la instalación primero.",
      };
    }

    // Cancelar instalaciones pendientes asociadas (soft-delete)
    if (installs.length > 0) {
      await admin
        .from("installations")
        .update({ deleted_at: new Date().toISOString() })
        .eq("contract_id", id)
        .is("deleted_at", null);
    }

    // Cancelar wallet entries pendientes (rejected o cancelled)
    await admin
      .from("wallet_entries")
      .update({
        status: "cancelled",
        rejected_reason: `Contrato cancelado: ${reason}`,
        validated_at: new Date().toISOString(),
        validated_by_user_id: session.user_id,
      })
      .eq("contract_id", id)
      .in("status", ["pending", "pending_settlement"]);

    const r = await admin
      .from("contracts")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by_user_id: session.user_id,
        cancellation_reason: reason,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (r.error) return { ok: false, error: r.error.message };

    // Liberar reservas de stock activas asociadas al contrato (fail-soft)
    try {
      const { cancelReservationsForContractAction } = await import(
        "@/modules/warehouses/reservation-actions"
      );
      await cancelReservationsForContractAction(id);
    } catch (e) {
      console.error("[cancelContract] cancelReservations falló:", e);
    }

    // Anular sales_records + reverse de puntos (fail-soft)
    try {
      await admin.from("sales_records").delete().eq("contract_id", id);
      const { reversePointsForSubject } = await import(
        "@/modules/points/award"
      );
      await reversePointsForSubject(
        session.company_id!,
        "contract",
        id,
        `contract_cancelled: ${reason}`,
      );
    } catch (e) {
      console.error("[cancelContract] reverse sales/points falló:", e);
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: id,
      kind: "contract.cancelled",
      payload: { reason, from_status: c.status },
      actor_user_id: session.user_id,
    });

    revalidatePath("/contratos");
    revalidatePath("/instalaciones");
    revalidatePath("/almacenes");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    console.error("[cancelContract]", e);
    return { ok: false, error: msg };
  }
}

/**
 * Reasigna comercial del contrato. Solo admin/director comercial.
 */
export async function reassignContractAction(
  contractId: string,
  userId: string | null,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Reasignación de contrato restringida a admin de empresa (decisión
  // del usuario): los directores ya no pueden reasignar.
  const isAdmin =
    session.is_superadmin || session.roles.includes("company_admin");
  if (!isAdmin) throw new Error("Solo el admin de empresa puede reasignar");

  // Admin client: la policy contracts_update_by_scope filtra por status IN
  // (draft, pending_data, pending_signature). Reasignar contratos firmados
  // o activos fallaría silente con cliente RLS-bound.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Capturar usuario saliente para notificarle también.
  const { data: prevRow } = await admin
    .from("contracts")
    .select("assigned_user_id")
    .eq("id", contractId)
    .maybeSingle();
  const prevUserId = (prevRow as { assigned_user_id: string | null } | null)?.assigned_user_id ?? null;

  const r = await admin
    .from("contracts")
    .update({
      assigned_user_id: userId,
      assigned_at: userId ? new Date().toISOString() : null,
    })
    .eq("id", contractId);
  if (r.error) throw new Error(r.error.message);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: contractId,
    kind: "contract.reassigned",
    payload: { from_user_id: prevUserId, to_user_id: userId },
    actor_user_id: session.user_id,
  });

  // Notificar al nuevo asignado
  if (userId && session.company_id) {
    try {
      const { notify } = await import("@/modules/notifications/notifier");
      await notify({
        company_id: session.company_id,
        recipient_user_id: userId,
        kind: "contract.reassigned",
        severity: "info",
        title: "Contrato asignado",
        body: `Te han asignado el contrato ${contractId.slice(0, 8)}`,
        subject_type: "contract",
        subject_id: contractId,
        action_url: `/contratos/${contractId}`,
      });
    } catch {
      /* no-op */
    }
  }

  // Notificar al saliente para que sepa que ya no es suyo
  if (prevUserId && prevUserId !== userId && session.company_id) {
    try {
      const { notify } = await import("@/modules/notifications/notifier");
      await notify({
        company_id: session.company_id,
        recipient_user_id: prevUserId,
        kind: "contract.unassigned",
        severity: "info",
        title: "Contrato reasignado",
        body: `El contrato ${contractId.slice(0, 8)} ya no está asignado a ti`,
        subject_type: "contract",
        subject_id: contractId,
        action_url: `/contratos/${contractId}`,
      });
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/contratos/${contractId}`);
  revalidatePath("/contratos");
}

/**
 * Sustituye el snapshot de cláusulas de un contrato. Solo admin/director.
 * Usado por el editor inline en la ficha contrato.
 */
/**
 * Actualiza las notas del contrato. Solo admin/director.
 */
export async function updateContractNotesAction(
  contractId: string,
  notes: string,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) throw new Error("Solo admin o director");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase.from("contracts").update({ notes: notes || null }).eq("id", contractId);
  revalidatePath(`/contratos/${contractId}`);
}

export async function updateContractClausesAction(
  contractId: string,
  clauses: Array<{ title: string; body: string; display_order: number }>,
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) throw new Error("Solo admin o director puede editar cláusulas");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("contracts")
    .update({ clauses_snapshot: clauses })
    .eq("id", contractId);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: contractId,
    kind: "contract.clauses_updated",
    payload: { count: clauses.length },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/contratos/${contractId}`);
}

/**
 * Quick-collect: marca el contract_payment como collected_pending_validation,
 * crea/actualiza el wallet_entry asociado y deja todo listo para validar.
 */
export async function collectContractPaymentAction(
  paymentId: string,
  options?: {
    when?: "now" | "on_installation";
    method?: "cash" | "card" | "bizum" | "transfer";
    notes?: string;
  },
): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // Admin client para todo el flow financiero. La policy
  // contract_payments_update / wallet_entries_update por scope puede
  // bloquear silentmente al comercial que cobra. Validamos sesión y
  // que el pago pertenece a la empresa con SELECT previo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const when = options?.when ?? "now";
  const newMethod = options?.method ?? null;

  const { data: pay } = await admin
    .from("contract_payments")
    .select("id, contract_id, concept, amount_cents, method, status, wallet_entry_id, company_id, moment")
    .eq("id", paymentId)
    .single();
  if (!pay) throw new Error("Pago no encontrado");
  const p = pay as {
    id: string;
    contract_id: string;
    concept: string;
    amount_cents: number;
    method: string;
    status: string;
    wallet_entry_id: string | null;
    company_id: string;
    moment: string | null;
  };
  // Reglas de quién puede cambiar:
  //  - pending → cualquiera (el comercial está cobrando por primera vez)
  //  - collected_pending_validation / validated → solo admin/director
  //    (puede haber sido un error humano, pero requiere supervisión)
  const isAdminOrDirector =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (p.status !== "pending" && !isAdminOrDirector) {
    throw new Error(
      "Este pago ya está cobrado. Solo admin o director comercial puede modificarlo.",
    );
  }
  if (p.company_id !== session.company_id) {
    throw new Error("Pago de otra empresa");
  }
  // Permitimos editar incluso si ya está cobrado/validado (caso "me he
  // equivocado de método o de momento"). Si había wallet_entry asociado
  // y se cambia el método/momento, lo actualizamos.
  const isEdit = p.status !== "pending";

  // Caso 1: cobro aplazado a la instalación → no se registra en wallet,
  // solo se marca el momento del pago como on_installation y, si el
  // usuario eligió método, se actualiza para que quede en el contrato.
  if (when === "on_installation") {
    const updates: Record<string, unknown> = {
      moment: "on_installation",
      // Vuelve a "pending" si lo estábamos editando: aún no se ha cobrado
      status: "pending",
      collected_at: null,
      collected_by_user_id: null,
      validated_at: null,
      validated_by_user_id: null,
    };
    if (newMethod) updates.method = newMethod;
    if (options?.notes !== undefined) updates.notes = options.notes;
    await admin.from("contract_payments").update(updates).eq("id", p.id);
    if (p.wallet_entry_id) {
      await admin
        .from("wallet_entries")
        .update({ status: "cancelled" })
        .eq("id", p.wallet_entry_id);
      await admin
        .from("contract_payments")
        .update({ wallet_entry_id: null })
        .eq("id", p.id);
    }
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "contract",
      subject_id: p.contract_id,
      kind: isEdit ? "contract_payment.edited" : "contract_payment.deferred",
      payload: { payment_id: p.id, method: newMethod ?? p.method, when: "on_installation" },
      actor_user_id: session.user_id,
    });
    revalidatePath(`/contratos/${p.contract_id}`);
    revalidatePath("/wallet");
    return;
  }

  // Caso 2: cobro ahora → cambia método si el usuario eligió otro,
  // marca como collected_pending_validation y materializa wallet_entry.
  const effectiveMethod = newMethod ?? p.method;
  // Efectivo necesita liquidación posterior (pending_settlement);
  // tarjeta/bizum/transferencia ya están en banco → collected.
  const walletStatus = effectiveMethod === "cash" ? "pending_settlement" : "collected";

  let walletEntryId = p.wallet_entry_id;
  if (walletEntryId) {
    await admin
      .from("wallet_entries")
      .update({
        method: effectiveMethod,
        status: walletStatus,
        collected_by_user_id: session.user_id,
        collected_at: new Date().toISOString(),
      })
      .eq("id", walletEntryId);
  } else {
    // Resolver customer_id desde el contrato (necesario para mostrar
    // cliente en /wallet y para poder facturar desde wallet)
    const { data: contractRow } = await admin
      .from("contracts")
      .select("customer_id")
      .eq("id", p.contract_id)
      .maybeSingle();
    const contractCustomerId = (contractRow as { customer_id: string | null } | null)
      ?.customer_id ?? null;

    const { data: created } = await admin
      .from("wallet_entries")
      .insert({
        company_id: session.company_id,
        contract_id: p.contract_id,
        contract_payment_id: p.id,
        customer_id: contractCustomerId,
        concept: p.concept,
        amount_cents: p.amount_cents,
        method: effectiveMethod,
        status: walletStatus,
        collected_by_user_id: session.user_id,
        collected_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    walletEntryId = (created as { id: string } | null)?.id ?? null;
  }

  const cpUpdates: Record<string, unknown> = {
    status: p.status === "validated" ? "validated" : "collected_pending_validation",
    method: effectiveMethod,
    // Preservamos el moment original del pago: si era "on_installation"
    // (cobro programado para la instalación) debe seguir siéndolo aunque
    // el comercial lo cobre "in situ" desde el wizard de instalación.
    // Solo si el moment es null (legacy) caemos a on_signature.
    moment: p.moment ?? "on_signature",
    wallet_entry_id: walletEntryId,
    collected_at: new Date().toISOString(),
    collected_by_user_id: session.user_id,
  };
  if (options?.notes !== undefined) cpUpdates.notes = options.notes;
  await admin.from("contract_payments").update(cpUpdates).eq("id", p.id);

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: p.contract_id,
    kind: isEdit ? "contract_payment.edited" : "wallet.payment_recorded",
    payload: {
      payment_id: p.id,
      amount_cents: p.amount_cents,
      method: effectiveMethod,
    },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/contratos/${p.contract_id}`);
  revalidatePath("/wallet");
}

export async function saveInstallPreferenceAction(
  contractId: string,
  input: {
    slot: "morning" | "afternoon" | "any" | "custom" | null;
    notes: string | null;
    days_of_week: number[] | null;
    dates: string[] | null;
  },
): Promise<void> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Estrategia ultra-defensiva: cada columna de migración reciente se
  // actualiza por separado. Si una columna no existe en BD, esa UPDATE
  // falla sin afectar al resto. Así el flujo nunca se rompe aunque sólo
  // estén aplicadas algunas migraciones.
  const updates: Array<[string, unknown]> = [
    ["preferred_install_time_slot", input.slot],
    ["preferred_install_time_notes", input.notes],
    ["preferred_install_days_of_week", input.days_of_week],
    ["preferred_install_dates", input.dates],
  ];

  let savedAny = false;
  let lastNonColumnError: string | null = null;
  for (const [col, val] of updates) {
    const r = await admin.from("contracts").update({ [col]: val }).eq("id", contractId);
    const errMsg = (r.error as { message?: string } | null)?.message ?? null;
    if (!errMsg) {
      savedAny = true;
      continue;
    }
    // Ignoramos errores de "columna no existe" — la migración no está aplicada
    if (/column .* does not exist|schema cache/i.test(errMsg)) continue;
    lastNonColumnError = errMsg;
  }

  if (!savedAny && lastNonColumnError) {
    throw new Error(lastNonColumnError);
  }
  if (!savedAny) {
    throw new Error(
      "No se pudo guardar la preferencia — aplica las migraciones recientes en Supabase",
    );
  }

  revalidatePath(`/contratos/${contractId}`);
}

export async function markContractActive(id: string) {
  const session = await requireSession();
  // Admin client: la policy contracts_update_by_scope sólo permite UPDATE
  // cuando status IN (draft, pending_data, pending_signature). El contrato
  // ya está en 'signed' cuando lo activamos → silent fail con RLS-bound.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("contracts")
    .update({ status: "active" })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  const scheduledJobs = await autoScheduleMaintenanceForContract(id);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "contract",
    subject_id: id,
    kind: "contract.activated",
    payload: { maintenance_jobs_scheduled: scheduledJobs },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/contratos/${id}`);
}

// ============================================================================
// Safe wrappers (result pattern) — 2026-05-20
// Devuelven { ok, error } para preservar mensaje real en producción.
// Aplican a todas las actions del módulo que se invocan desde cliente.
// ============================================================================

export async function updateContractNotesSafeAction(
  contractId: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateContractNotesAction(contractId, notes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function updateContractClausesSafeAction(
  contractId: string,
  clauses: Array<{ title: string; body: string; display_order: number }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateContractClausesAction(contractId, clauses);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function collectContractPaymentSafeAction(
  paymentId: string,
  input: {
    when: "now" | "on_installation";
    method?: "cash" | "card" | "bizum" | "transfer";
    notes?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await collectContractPaymentAction(paymentId, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function reassignContractSafeAction(
  contractId: string,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await reassignContractAction(contractId, userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function saveInstallPreferenceSafeAction(
  contractId: string,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveInstallPreferenceAction(contractId, input as never);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
