"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import { proposalCreateSchema } from "./schemas";
import type { ProposalDetail, ProposalItem, ProposalListItem } from "./types";
import { bumpLeadStatus, convertLeadToCustomerAction } from "@/modules/leads/actions";
import { awardPoints, getPointsSettings } from "@/modules/points/award";

export async function listProposals(filters?: { status?: string }): Promise<ProposalListItem[]> {
  await requireSession();
  const supabase = await createClient();
  let query = supabase
    .from("proposals")
    .select(
      "id, reference_code, status, customer_id, lead_id, total_cash_cents, validity_until, created_at, version_number",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters?.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
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

  // Si la propuesta es para un lead, su estado avanza a "proposal_created"
  if (parsed.lead_id) {
    await bumpLeadStatus(parsed.lead_id, "proposal_created");
  }

  revalidatePath("/propuestas");
  redirect(`/propuestas/${proposalId}` as never);
}

export async function markProposalSent(id: string) {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: prop } = await supabase
    .from("proposals")
    .select("lead_id")
    .eq("id", id)
    .single();
  await supabase
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.sent",
    payload: {},
    actor_user_id: session.user_id,
  });
  const leadId = (prop as { lead_id: string | null } | null)?.lead_id;
  if (leadId) await bumpLeadStatus(leadId, "proposal_sent");
  revalidatePath(`/propuestas/${id}`);
  revalidatePath("/propuestas");
}

/**
 * Acepta la propuesta. Si está vinculada a un lead, convierte el lead en
 * cliente (crea customer + mueve direcciones), supersede el resto de
 * propuestas del mismo lead y devuelve el customer_id para redirect.
 * Si está vinculada a un cliente existente, sólo marca aceptada.
 */
export async function markProposalAccepted(id: string): Promise<{ customer_id: string | null }> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: prop } = await supabase
    .from("proposals")
    .select("id, lead_id, customer_id, variant_group_id")
    .eq("id", id)
    .single();
  if (!prop) throw new Error("Propuesta no encontrada");
  const p = prop as {
    id: string;
    lead_id: string | null;
    customer_id: string | null;
    variant_group_id: string | null;
  };

  await supabase
    .from("proposals")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", id);

  // Si es parte de un grupo de variantes, supersede a las hermanas
  if (p.variant_group_id) {
    await supabase
      .from("proposals")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_reason: "Variante hermana aceptada",
        superseded_at: new Date().toISOString(),
        superseded_by_id: id,
      })
      .eq("variant_group_id", p.variant_group_id)
      .neq("id", id)
      .in("status", ["draft", "sent"]);
  }
  await supabase.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.accepted",
    payload: {},
    actor_user_id: session.user_id,
  });

  let customerId: string | null = p.customer_id;
  if (p.lead_id) {
    // Convertir lead → customer (mueve direcciones, marca lead converted)
    customerId = await convertLeadToCustomerAction(p.lead_id);
    // Vincular esta propuesta al cliente recién creado y supersede el resto
    await supabase
      .from("proposals")
      .update({ customer_id: customerId, lead_id: null })
      .eq("id", id);
    await supabase
      .from("proposals")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_reason: "Superseded by accepted sibling",
        superseded_at: new Date().toISOString(),
      })
      .eq("lead_id", p.lead_id)
      .neq("id", id)
      .in("status", ["draft", "sent"]);
  }

  // Puntos: comercial + (si origen TMK) telemarketer
  if (session.company_id) {
    try {
      const cfg = await getPointsSettings(session.company_id);
      // Detalles del lead (si lo había) para origen tmk + assigned_user
      let assignedUserId: string | null = null;
      let originTmkUserId: string | null = null;
      if (p.lead_id) {
        const { data: l } = await supabase
          .from("leads")
          .select("assigned_user_id, origin_tmk_user_id")
          .eq("id", p.lead_id)
          .maybeSingle();
        const lObj = l as {
          assigned_user_id: string | null;
          origin_tmk_user_id: string | null;
        } | null;
        assignedUserId = lObj?.assigned_user_id ?? null;
        originTmkUserId = lObj?.origin_tmk_user_id ?? null;
      } else if (customerId) {
        const { data: c } = await supabase
          .from("customers")
          .select("assigned_user_id, source_lead_id")
          .eq("id", customerId)
          .maybeSingle();
        const cObj = c as {
          assigned_user_id: string | null;
          source_lead_id: string | null;
        } | null;
        assignedUserId = cObj?.assigned_user_id ?? null;
        if (cObj?.source_lead_id) {
          const { data: l } = await supabase
            .from("leads")
            .select("origin_tmk_user_id")
            .eq("id", cObj.source_lead_id)
            .maybeSingle();
          originTmkUserId =
            (l as { origin_tmk_user_id: string | null } | null)?.origin_tmk_user_id ?? null;
        }
      }
      // Quién es el comercial: assigned_user_id si existe, fallback al actor
      const commercialUserId = assignedUserId ?? session.user_id;

      // Cantidad de items + check de descuento
      const { data: items } = await supabase
        .from("proposal_items")
        .select("quantity, unit_price_cash_cents, product_id")
        .eq("proposal_id", id);
      type Item = {
        quantity: number;
        unit_price_cash_cents: number | null;
        product_id: string;
      };
      const itemList = (items ?? []) as Item[];
      const totalEquipments = itemList.reduce((s, it) => s + it.quantity, 0);

      // Detectar si alguno se vendió por debajo del mínimo comercial autorizado
      const productIds = itemList.map((i) => i.product_id);
      let hasDiscount = false;
      if (productIds.length > 0) {
        const { data: plans } = await supabase
          .from("product_pricing_plans")
          .select("product_id, min_authorized_cents")
          .in("product_id", productIds)
          .eq("plan_type", "cash");
        const minMap = new Map<string, number | null>();
        for (const pl of (plans ?? []) as Array<{
          product_id: string;
          min_authorized_cents: number | null;
        }>) {
          minMap.set(pl.product_id, pl.min_authorized_cents);
        }
        for (const it of itemList) {
          const min = minMap.get(it.product_id);
          if (
            min != null &&
            it.unit_price_cash_cents != null &&
            it.unit_price_cash_cents < min
          ) {
            hasDiscount = true;
            break;
          }
        }
      }

      const basePoints = totalEquipments * cfg.points_per_equipment_sold;
      const adjustedPoints = hasDiscount
        ? Math.round((basePoints * (100 - cfg.discount_penalty_percent)) / 100)
        : basePoints;

      // Reparto si origen TMK
      const tmkPct = originTmkUserId ? cfg.tmk_split_percent : 0;
      const tmkPoints = Math.round((adjustedPoints * tmkPct) / 100);
      const commercialPoints = adjustedPoints - tmkPoints;

      if (commercialPoints > 0 && commercialUserId) {
        await awardPoints({
          company_id: session.company_id,
          user_id: commercialUserId,
          points: commercialPoints,
          reason: hasDiscount ? "sale_with_discount" : "sale",
          subject_type: "proposal",
          subject_id: id,
          metadata: { equipments: totalEquipments, has_discount: hasDiscount },
        });
      }
      if (tmkPoints > 0 && originTmkUserId) {
        await awardPoints({
          company_id: session.company_id,
          user_id: originTmkUserId,
          points: tmkPoints,
          reason: "sale_tmk_split",
          subject_type: "proposal",
          subject_id: id,
          metadata: { split_pct: tmkPct, has_discount: hasDiscount },
        });
      }
    } catch {
      /* no-op */
    }
  }

  revalidatePath(`/propuestas/${id}`);
  revalidatePath("/propuestas");
  if (customerId) revalidatePath(`/clientes/${customerId}`);
  return { customer_id: customerId };
}

/**
 * Devuelve las propuestas de un cliente concreto.
 */
export async function listProposalsByCustomer(customerId: string): Promise<ProposalListItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("proposals")
    .select(
      "id, reference_code, status, customer_id, lead_id, total_cash_cents, validity_until, created_at, version_number",
    )
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as ProposalListItem[]).map((r) => ({
    ...r,
    customer_or_lead_name: "",
  }));
}

/**
 * Devuelve las propuestas de un lead concreto.
 */
export async function listProposalsByLead(leadId: string): Promise<ProposalListItem[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("proposals")
    .select(
      "id, reference_code, status, customer_id, lead_id, total_cash_cents, validity_until, created_at, version_number",
    )
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as ProposalListItem[]).map((r) => ({
    ...r,
    customer_or_lead_name: "",
  }));
}

/**
 * Duplica una propuesta como nueva variante del mismo grupo. Si la original
 * no tenía variant_group_id, se crea uno y se asigna a ambas. Copia las
 * líneas (proposal_items) tal cual; el comercial las edita después.
 */
export async function duplicateProposalAsVariantAction(
  originalId: string,
  label: string,
): Promise<string> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: orig } = await supabase
    .from("proposals")
    .select("*")
    .eq("id", originalId)
    .single();
  if (!orig) throw new Error("Original no encontrada");
  const o = orig as Record<string, unknown> & {
    id: string;
    variant_group_id: string | null;
    company_id: string;
  };

  // Asegurar variant_group_id en la original
  let groupId = o.variant_group_id;
  if (!groupId) {
    groupId = crypto.randomUUID();
    await supabase
      .from("proposals")
      .update({ variant_group_id: groupId, variant_label: o.variant_label ?? "A" })
      .eq("id", originalId);
  }

  // Crear nueva propuesta clonando los campos relevantes (excluye id, fechas terminales)
  const EXCLUDE = new Set([
    "id",
    "reference_code",
    "sent_at",
    "accepted_at",
    "rejected_at",
    "rejected_reason",
    "superseded_at",
    "superseded_by_id",
    "created_at",
    "updated_at",
  ]);
  const cloneable: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!EXCLUDE.has(k)) cloneable[k] = v;
  }
  cloneable.status = "draft";
  cloneable.variant_group_id = groupId;
  cloneable.variant_label = label.trim() || "B";
  cloneable.parent_proposal_id = originalId;

  const { data: created, error } = await supabase
    .from("proposals")
    .insert(cloneable)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newId = (created as { id: string }).id;

  // Copiar líneas
  const { data: items } = await supabase
    .from("proposal_items")
    .select("*")
    .eq("proposal_id", originalId);
  type Item = Record<string, unknown> & { id: string; proposal_id: string };
  const ITEM_EXCLUDE = new Set(["id", "created_at", "updated_at"]);
  const lines = ((items ?? []) as Item[]).map((it) => {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(it)) {
      if (!ITEM_EXCLUDE.has(k)) copy[k] = v;
    }
    copy.proposal_id = newId;
    return copy;
  });
  if (lines.length > 0) {
    await supabase.from("proposal_items").insert(lines);
  }

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "proposal",
    subject_id: newId,
    kind: "proposal.variant_created",
    payload: { from_proposal_id: originalId, variant_group_id: groupId, label },
    actor_user_id: session.user_id,
  });

  revalidatePath(`/propuestas/${originalId}`);
  revalidatePath(`/propuestas/${newId}`);
  revalidatePath("/propuestas");
  return newId;
}

/**
 * Devuelve las propuestas hermanas (mismo variant_group_id) ordenadas por
 * variant_label. Incluye la propia.
 */
export async function listProposalVariants(
  proposalId: string,
): Promise<
  Array<{
    id: string;
    variant_label: string | null;
    status: string;
    total_cash_cents: number | null;
    monthly_renting_min_cents: number | null;
    monthly_rental_cents: number | null;
  }>
> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: own } = await supabase
    .from("proposals")
    .select("variant_group_id")
    .eq("id", proposalId)
    .maybeSingle();
  const gid = (own as { variant_group_id: string | null } | null)?.variant_group_id;
  if (!gid) return [];
  const { data } = await supabase
    .from("proposals")
    .select(
      "id, variant_label, status, total_cash_cents, monthly_renting_min_cents, monthly_rental_cents",
    )
    .eq("variant_group_id", gid)
    .order("variant_label", { ascending: true });
  return (data ?? []) as Array<{
    id: string;
    variant_label: string | null;
    status: string;
    total_cash_cents: number | null;
    monthly_renting_min_cents: number | null;
    monthly_rental_cents: number | null;
  }>;
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
