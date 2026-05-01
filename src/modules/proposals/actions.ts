"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { proposalCreateSchema } from "./schemas";
import type { ProposalDetail, ProposalItem, ProposalListItem } from "./types";

export async function listProposals(): Promise<ProposalListItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposals")
    .select(
      "id, reference_code, status, customer_id, lead_id, total_cash_cents, validity_until, created_at, version_number",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status: ProposalListItem["status"];
    customer_id: string | null;
    lead_id: string | null;
    total_cash_cents: number | null;
    validity_until: string | null;
    created_at: string;
    version_number: number;
  }>;
  if (rows.length === 0) return [];

  const customerIds = rows.map((r) => r.customer_id).filter(Boolean) as string[];
  const leadIds = rows.map((r) => r.lead_id).filter(Boolean) as string[];

  const [custRes, leadRes] = await Promise.all([
    customerIds.length > 0
      ? supabase
          .from("customers")
          .select("id, party_kind, legal_name, trade_name, first_name, last_name")
          .in("id", customerIds)
      : Promise.resolve({ data: [] as never[] }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id, party_kind, legal_name, trade_name, first_name, last_name")
          .in("id", leadIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  type Party = {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  function nameOf(p: Party) {
    return p.party_kind === "company"
      ? p.trade_name || p.legal_name || "Sin nombre"
      : `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Sin nombre";
  }
  const cMap = new Map(
    ((custRes.data ?? []) as Party[]).map((p) => [p.id, nameOf(p)]),
  );
  const lMap = new Map(((leadRes.data ?? []) as Party[]).map((p) => [p.id, nameOf(p)]));

  return rows.map((r) => ({
    ...r,
    customer_or_lead_name: r.customer_id
      ? cMap.get(r.customer_id) ?? "Cliente"
      : r.lead_id
        ? `Lead: ${lMap.get(r.lead_id) ?? "?"}`
        : "—",
  }));
}

export async function getProposal(id: string): Promise<ProposalDetail> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  const p = data as ProposalDetail & { customer_or_lead_name?: string };
  // Resolver nombre
  let name = "—";
  if (p.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", p.customer_id)
      .single();
    if (c) {
      const cc = c as {
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      name =
        cc.party_kind === "company"
          ? cc.trade_name || cc.legal_name || "Sin nombre"
          : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "Sin nombre";
    }
  } else if (p.lead_id) {
    const { data: l } = await supabase
      .from("leads")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", p.lead_id)
      .single();
    if (l) {
      const ll = l as {
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      name =
        "Lead: " +
        (ll.party_kind === "company"
          ? ll.trade_name || ll.legal_name || "Sin nombre"
          : `${ll.first_name ?? ""} ${ll.last_name ?? ""}`.trim() || "Sin nombre");
    }
  }
  return { ...p, customer_or_lead_name: name };
}

export async function getProposalItems(proposalId: string): Promise<ProposalItem[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_items")
    .select("id, proposal_id, product_id, product_name_snapshot, quantity, unit_price_cash_cents, notes")
    .eq("proposal_id", proposalId)
    .order("display_order");
  if (error) throw error;
  return (data ?? []) as ProposalItem[];
}

export async function createProposalAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = proposalCreateSchema.parse(input);

  const supabase = await createClient();
  // Calcular total_cash
  const total_cash_cents = parsed.items.reduce(
    (sum, it) => sum + it.unit_price_cents * it.quantity,
    0,
  );

  const { data, error } = await supabase
    .from("proposals")
    .insert({
      company_id: session.company_id,
      customer_id: parsed.customer_id || null,
      lead_id: parsed.lead_id || null,
      status: "draft",
      validity_until: parsed.validity_until || null,
      total_cash_cents,
      notes: parsed.notes || null,
      created_by: session.user_id,
      version_number: 1,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const proposalId = (data as { id: string }).id;

  // Insertar items con snapshot del nombre del producto
  const productIds = parsed.items.map((i) => i.product_id);
  const { data: prods } = await supabase
    .from("products")
    .select("id, name")
    .in("id", productIds);
  const nameMap = new Map(
    ((prods ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  const itemRows = parsed.items.map((it, i) => ({
    proposal_id: proposalId,
    company_id: session.company_id!,
    product_id: it.product_id,
    quantity: it.quantity,
    product_name_snapshot: nameMap.get(it.product_id) ?? "Producto",
    unit_price_cash_cents: it.unit_price_cents,
    display_order: i,
  }));
  await supabase.from("proposal_items").insert(itemRows as never);

  // Una payment option cash con el total
  await supabase.from("proposal_payment_options").insert({
    proposal_id: proposalId,
    company_id: session.company_id,
    plan_type: "cash",
    total_cents: total_cash_cents,
    is_recommended: true,
  } as never);

  // Evento timeline
  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "proposal",
    subject_id: proposalId,
    kind: "proposal.created",
    payload: { items: parsed.items.length, total_cash_cents },
    actor_user_id: session.user_id,
  } as never);

  revalidatePath("/propuestas");
  redirect(`/propuestas/${proposalId}` as never);
}

export async function markProposalSent(id: string) {
  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() } as never)
    .eq("id", id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.sent",
    payload: {},
    actor_user_id: session.user_id,
  } as never);
  revalidatePath(`/propuestas/${id}`);
  revalidatePath("/propuestas");
}

export async function markProposalAccepted(id: string) {
  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("proposals")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.accepted",
    payload: {},
    actor_user_id: session.user_id,
  } as never);
  revalidatePath(`/propuestas/${id}`);
}

export async function markProposalRejected(id: string, reason?: string) {
  const session = await requireSession();
  const supabase = await createClient();
  await supabase
    .from("proposals")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_reason: reason ?? null,
    } as never)
    .eq("id", id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.rejected",
    payload: { reason: reason ?? null },
    actor_user_id: session.user_id,
  } as never);
  revalidatePath(`/propuestas/${id}`);
}
