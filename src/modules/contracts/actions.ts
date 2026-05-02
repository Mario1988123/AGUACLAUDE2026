"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { contractCreateSchema } from "./schemas";
import type { ContractDetail, ContractListItem } from "./types";
import { notifyContractSigned } from "@/modules/notifications/notifier";
import { autoScheduleMaintenanceForContract } from "@/modules/maintenance/auto-schedule";

export async function listContracts(): Promise<ContractListItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contracts")
    .select(
      "id, reference_code, status, customer_id, plan_type, total_cash_cents, monthly_cents, signed_at, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
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
  return data as ContractDetail;
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

  const { data: proposal, error: pErr } = await supabase
    .from("proposals")
    .select("id, status, customer_id, lead_id, total_cash_cents")
    .eq("id", proposalId)
    .single();
  if (pErr) throw pErr;
  const p = proposal as {
    id: string;
    status: string;
    customer_id: string | null;
    lead_id: string | null;
    total_cash_cents: number | null;
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
    .select("id")
    .eq("customer_id", p.customer_id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!hasBank) pending.push("iban");
  // Dirección
  const { data: hasAddr } = await supaAny
    .from("addresses")
    .select("id")
    .eq("customer_id", p.customer_id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!hasAddr) pending.push("address");

  // Snapshot cláusulas: copia los templates activos del plan al contrato.
  // Si no hay templates aún (empresa nueva), siembra los defaults via RPC.
  let { data: tpls } = await supaAny
    .from("contract_clause_templates")
    .select("title, body, display_order")
    .eq("company_id", session.company_id)
    .eq("plan_type", "cash")
    .eq("is_active", true)
    .order("display_order");
  if (!tpls || (tpls as Array<unknown>).length === 0) {
    await supaAny.rpc("seed_default_clauses", { p_company_id: session.company_id });
    const r = await supaAny
      .from("contract_clause_templates")
      .select("title, body, display_order")
      .eq("company_id", session.company_id)
      .eq("plan_type", "cash")
      .eq("is_active", true)
      .order("display_order");
    tpls = r.data;
  }
  const clausesSnapshot = ((tpls ?? []) as Array<{
    title: string;
    body: string;
    display_order: number;
  }>).map((t) => ({ title: t.title, body: t.body, display_order: t.display_order }));

  // Crear contract
  const { data: created, error: cErr } = await supabase
    .from("contracts")
    .insert({
      company_id: session.company_id,
      customer_id: p.customer_id,
      source_proposal_id: p.id,
      plan_type: "cash",
      total_cash_cents: p.total_cash_cents,
      monthly_cents: null,
      status: has_provisional_data ? "pending_data" : "pending_signature",
      has_provisional_data,
      customer_snapshot: cust,
      clauses_snapshot: clausesSnapshot,
      pending_fields: pending,
      created_by: session.user_id,
    } as never)
    .select("id")
    .single();
  if (cErr) throw cErr;
  const contractId = (created as { id: string }).id;

  // Copiar items desde proposal_items
  const { data: items } = await supabase
    .from("proposal_items")
    .select("product_id, product_name_snapshot, quantity, unit_price_cash_cents, display_order")
    .eq("proposal_id", p.id)
    .order("display_order");
  type PI = {
    product_id: string;
    product_name_snapshot: string;
    quantity: number;
    unit_price_cash_cents: number | null;
    display_order: number;
  };
  const ps = (items ?? []) as PI[];

  // Necesitamos product_kind para snapshot
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

  // Crear un pago básico contado por el total
  if (p.total_cash_cents && p.total_cash_cents > 0) {
    await supabase.from("contract_payments").insert({
      contract_id: contractId,
      company_id: session.company_id,
      concept: "Pago contado",
      amount_cents: p.total_cash_cents,
      method: "transfer",
      moment: "on_signature",
      status: "pending",
    } as never);
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

  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "contract",
    subject_id: id,
    kind: "contract.signed",
    payload: { wallet_entries_created: list.length },
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
