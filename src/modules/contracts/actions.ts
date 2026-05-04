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
}): Promise<ContractListItem[]> {
  await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("contracts")
    .select(
      "id, reference_code, status, customer_id, plan_type, total_cash_cents, monthly_cents, signed_at, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.plan_type) query = query.eq("plan_type", filters.plan_type);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status: ContractListItem["status"];
    customer_id: string;
    plan_type: "cash" | "renting" | "rental";
    total_cash_cents: number | null;
    monthly_cents: number | null;
    signed_at: string | null;
    created_at: string;
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
  return rows.map((r) => ({ ...r, customer_name: nameMap.get(r.customer_id) ?? "Cliente" }));
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

  const supabase = await createClient();

  // Intentamos primero con los campos del overhaul (chosen_plan_type/
  // chosen_duration_months). Si la migración 20260503340000 no está
  // aplicada, retry con campos básicos para que el flujo no se rompa.
  let proposal: unknown = null;
  let pErr: { message?: string } | null = null;
  {
    const r = await supabase
      .from("proposals")
      .select(
        "id, status, customer_id, lead_id, total_cash_cents, monthly_renting_min_cents, monthly_rental_cents, chosen_plan_type, chosen_duration_months",
      )
      .eq("id", proposalId)
      .single();
    proposal = r.data;
    pErr = r.error as { message?: string } | null;
    if (pErr && /column .* does not exist|chosen_plan_type|chosen_duration_months/i.test(pErr.message ?? "")) {
      const r2 = await supabase
        .from("proposals")
        .select(
          "id, status, customer_id, lead_id, total_cash_cents, monthly_renting_min_cents, monthly_rental_cents",
        )
        .eq("id", proposalId)
        .single();
      proposal = r2.data
        ? { ...(r2.data as object), chosen_plan_type: null, chosen_duration_months: null }
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
  };
  let createdRow: { id: string } | null = null;
  {
    const r = await supabase
      .from("contracts")
      .insert(fullContractPayload as never)
      .select("id")
      .single();
    const cErr = r.error as { message?: string } | null;
    if (cErr && /column .* does not exist|has_provisional_data|customer_snapshot|clauses_snapshot|pending_fields|source_proposal_id/i.test(cErr.message ?? "")) {
      // Retry con payload mínimo (sin snapshots)
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

export async function markContractSigned(id: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("contracts")
    .update({
      status: "signed",
      signed_at: new Date().toISOString(),
      signed_by_user_id: session.user_id,
    })
    .eq("id", id);

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

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "contract",
    subject_id: id,
    kind: "contract.signed",
    payload: {
      wallet_entries_created: list.length,
      maintenance_jobs_scheduled: scheduledCount,
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

  revalidatePath(`/contratos/${id}`);
  revalidatePath("/contratos");
  revalidatePath("/wallet");
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
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) throw new Error("Solo admin o director comercial");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("contracts")
    .update({
      assigned_user_id: userId,
      assigned_at: userId ? new Date().toISOString() : null,
    })
    .eq("id", contractId);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: contractId,
    kind: "contract.reassigned",
    payload: { to_user_id: userId },
    actor_user_id: session.user_id,
  });

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const when = options?.when ?? "now";
  const newMethod = options?.method ?? null;

  const { data: pay } = await supabase
    .from("contract_payments")
    .select("id, contract_id, concept, amount_cents, method, status, wallet_entry_id")
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
  };
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
    await supabase.from("contract_payments").update(updates).eq("id", p.id);
    // Si había wallet_entry, la cancelamos: el cobro ya no es ahora
    if (p.wallet_entry_id) {
      await supabase
        .from("wallet_entries")
        .update({ status: "cancelled" })
        .eq("id", p.wallet_entry_id);
      await supabase
        .from("contract_payments")
        .update({ wallet_entry_id: null })
        .eq("id", p.id);
    }
    await supabase.from("events").insert({
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
    await supabase
      .from("wallet_entries")
      .update({
        method: effectiveMethod,
        status: walletStatus,
        collected_by_user_id: session.user_id,
        collected_at: new Date().toISOString(),
      })
      .eq("id", walletEntryId);
  } else {
    const { data: created } = await supabase
      .from("wallet_entries")
      .insert({
        company_id: session.company_id,
        contract_id: p.contract_id,
        contract_payment_id: p.id,
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
    // Si estábamos editando un cobro ya validado, mantenemos validated;
    // si no, marca como collected_pending_validation
    status: p.status === "validated" ? "validated" : "collected_pending_validation",
    method: effectiveMethod,
    moment: "on_signature",
    wallet_entry_id: walletEntryId,
    collected_at: new Date().toISOString(),
    collected_by_user_id: session.user_id,
  };
  if (options?.notes !== undefined) cpUpdates.notes = options.notes;
  await supabase.from("contract_payments").update(cpUpdates).eq("id", p.id);

  await supabase.from("events").insert({
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
  const supabase = await createClient();
  await supabase
    .from("contracts")
    .update({ status: "active" } as never)
    .eq("id", id);
  const scheduledJobs = await autoScheduleMaintenanceForContract(id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "contract",
    subject_id: id,
    kind: "contract.activated",
    payload: { maintenance_jobs_scheduled: scheduledJobs },
    actor_user_id: session.user_id,
  } as never);
  revalidatePath(`/contratos/${id}`);
}
