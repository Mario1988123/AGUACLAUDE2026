"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { proposalCreateSchema } from "./schemas";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import type { ProposalDetail, ProposalItem, ProposalListItem } from "./types";
import { bumpLeadStatus, convertLeadToCustomerAction } from "@/modules/leads/actions";
import { awardPoints, getPointsSettings } from "@/modules/points/award";

export async function listProposals(filters?: { status?: string }): Promise<ProposalListItem[]> {
  const session = await requireSession();
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  const supabase = await createClient();
  let query = supabase
    .from("proposals")
    .select(
      "id, reference_code, status, customer_id, lead_id, total_cash_cents, validity_until, created_at, version_number, chosen_plan_type, chosen_duration_months, monthly_rental_cents, monthly_renting_min_cents",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  // Nivel 3 ve solo las suyas; nivel 2 ve las suyas + las de su equipo
  // (resolveVisibleUserIds devuelve la lista vía team_assignments);
  // nivel 1 ve todas.
  if (visibleUserIds) {
    query = query.in("created_by", visibleUserIds);
  }
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
    chosen_plan_type: "cash" | "rental" | "renting" | "financing" | null;
    chosen_duration_months: number | null;
    monthly_rental_cents: number | null;
    monthly_renting_min_cents: number | null;
  }>;
  if (rows.length === 0) return [];

  const proposalIds = rows.map((r) => r.id);
  const customerIds = rows.map((r) => r.customer_id).filter(Boolean) as string[];
  const leadIds = rows.map((r) => r.lead_id).filter(Boolean) as string[];

  const [custRes, leadRes, itemsRes] = await Promise.all([
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
    supabase
      .from("proposal_items")
      .select("proposal_id, product_name_snapshot, quantity, display_order")
      .in("proposal_id", proposalIds)
      .order("display_order"),
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

  // Resumen de productos por propuesta — primer producto + "+N más"
  const itemsByProposal = new Map<string, Array<{ name: string; qty: number }>>();
  for (const it of (itemsRes.data ?? []) as Array<{
    proposal_id: string;
    product_name_snapshot: string;
    quantity: number;
  }>) {
    const list = itemsByProposal.get(it.proposal_id) ?? [];
    list.push({ name: it.product_name_snapshot, qty: it.quantity });
    itemsByProposal.set(it.proposal_id, list);
  }

  return rows.map((r) => {
    const items = itemsByProposal.get(r.id) ?? [];
    let summary: string | null = null;
    if (items.length > 0 && items[0]) {
      const first = items[0]!;
      summary = first.qty > 1 ? `${first.qty}× ${first.name}` : first.name;
      if (items.length > 1) summary += ` +${items.length - 1}`;
    }
    const monthly =
      r.chosen_plan_type === "rental"
        ? r.monthly_rental_cents
        : r.chosen_plan_type === "renting"
          ? r.monthly_renting_min_cents
          : null;
    return {
      ...r,
      customer_or_lead_name: r.customer_id
        ? cMap.get(r.customer_id) ?? "Cliente"
        : r.lead_id
          ? `Lead: ${lMap.get(r.lead_id) ?? "?"}`
          : "—",
      product_summary: summary,
      chosen_plan_type: r.chosen_plan_type,
      duration_months: r.chosen_duration_months,
      monthly_cents: monthly,
    };
  });
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
  const p = data as ProposalDetail & {
    customer_or_lead_name?: string;
    company_id?: string;
  };
  // Backfill: si no tiene reference_code, generarlo ahora (one-shot)
  if (!p.reference_code && p.company_id) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const year = new Date(p.created_at).getFullYear();
      const yearPrefix = `P-${year}-`;
      const { data: last } = await admin
        .from("proposals")
        .select("reference_code")
        .eq("company_id", p.company_id)
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
      await admin.from("proposals").update({ reference_code: code }).eq("id", id);
      p.reference_code = code;
    } catch {
      /* fail-soft */
    }
  }
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
    // Self-healing: si el lead ya fue convertido a cliente, mover esta
    // propuesta al cliente (la policy proposals_update_draft bloquea esto
    // si el status no es draft, así que usamos admin client).
    const { data: leadConv } = await supabase
      .from("leads")
      .select("converted_to_customer_id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", p.lead_id)
      .single();
    const lc = leadConv as
      | {
          converted_to_customer_id: string | null;
          party_kind: "individual" | "company";
          legal_name: string | null;
          trade_name: string | null;
          first_name: string | null;
          last_name: string | null;
        }
      | null;
    if (lc?.converted_to_customer_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = createAdminClient() as any;
        await admin
          .from("proposals")
          .update({ customer_id: lc.converted_to_customer_id, lead_id: null })
          .eq("id", id);
        p.customer_id = lc.converted_to_customer_id;
        p.lead_id = null;
        const { data: c } = await supabase
          .from("customers")
          .select("party_kind, legal_name, trade_name, first_name, last_name")
          .eq("id", lc.converted_to_customer_id)
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
        return { ...p, customer_or_lead_name: name };
      } catch {
        /* fall through to lead label */
      }
    }
    const l = lc;
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

export interface ProposalPaymentOption {
  id: string;
  plan_type: "cash" | "rental" | "renting" | "financing";
  duration_months: number | null;
  monthly_cents: number | null;
  total_cents: number;
  permanence_months: number | null;
  deposit_cents: number;
  installation_fee_cents: number;
  first_payment_cents: number | null;
  maintenance_included: boolean;
  maintenance_periodicity_months: number | null;
  is_recommended: boolean;
  display_order: number;
}

export async function getProposalPaymentOptions(
  proposalId: string,
): Promise<ProposalPaymentOption[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposal_payment_options")
    .select(
      "id, plan_type, duration_months, monthly_cents, total_cents, permanence_months, deposit_cents, installation_fee_cents, first_payment_cents, maintenance_included, maintenance_periodicity_months, is_recommended, display_order",
    )
    .eq("proposal_id", proposalId)
    .order("display_order");
  if (error) {
    // Defensa-en-profundidad: si la tabla no existe en BD (migración 20260501121200
    // no aplicada o schema cache de PostgREST obsoleta) devolvemos vacío en lugar
    // de reventar la página entera. PGRST205 = tabla no encontrada en cache.
    const code = (error as { code?: string }).code;
    const msg = (error as { message?: string }).message ?? "";
    if (code === "PGRST205" || /could not find the table|does not exist/i.test(msg)) {
      console.warn("[getProposalPaymentOptions] proposal_payment_options no disponible:", msg);
      return [];
    }
    throw error;
  }
  return ((data as ProposalPaymentOption[] | null) ?? []);
}

export async function getProposalItems(proposalId: string): Promise<ProposalItem[]> {
  await requireSession();
  const supabase = await createClient();
  // Intentamos traer todos los campos de configuración (instalación,
  // mantenimiento, fianza, 1ª cuota). Si el schema no tiene alguna columna
  // (migración 20260503340000 no aplicada) caemos al select básico.
  const fullSelect =
    "id, proposal_id, product_id, product_name_snapshot, quantity, unit_price_cash_cents, notes, installation_included, installation_price_cents, maintenance_included, maintenance_until_date, maintenance_price_cents, maintenance_periodicity_months, deposit_cents, charge_first_payment_now";
  const r = await supabase
    .from("proposal_items")
    .select(fullSelect)
    .eq("proposal_id", proposalId)
    .order("display_order");
  if (r.error) {
    const code = (r.error as { code?: string }).code;
    const msg = (r.error as { message?: string }).message ?? "";
    if (code === "42703" || /column .* does not exist/i.test(msg)) {
      const fb = await supabase
        .from("proposal_items")
        .select(
          "id, proposal_id, product_id, product_name_snapshot, quantity, unit_price_cash_cents, notes",
        )
        .eq("proposal_id", proposalId)
        .order("display_order");
      if (fb.error) throw fb.error;
      return (fb.data ?? []) as ProposalItem[];
    }
    throw r.error;
  }
  return (r.data ?? []) as ProposalItem[];
}

export async function createProposalAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  const parsed = parseOrFriendly(proposalCreateSchema, input, "Propuesta");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Total = suma cuota * cantidad por todas las líneas (la cuota representa
  // cash si plan=cash, mensual si rental/renting). Para mostrar también en
  // las columnas de monthly se calcula aparte abajo.
  const lineTotal = (it: typeof parsed.items[number]) =>
    it.unit_price_cents * it.quantity;
  const planTotal = parsed.items.reduce((s, it) => s + lineTotal(it), 0);

  // Detectar si la propuesta requiere aprobación: comparar cuota con mínimo
  // autorizado del plan correspondiente para cada producto.
  let requiresApproval = false;
  if (parsed.items.length > 0) {
    const productIds = Array.from(new Set(parsed.items.map((i) => i.product_id)));
    const { data: plans } = await supabase
      .from("product_pricing_plans")
      .select("product_id, plan_type, min_authorized_cents, duration_months")
      .in("product_id", productIds)
      .eq("plan_type", parsed.chosen_plan_type)
      .eq("is_active", true);
    type Plan = {
      product_id: string;
      plan_type: string;
      min_authorized_cents: number | null;
      duration_months: number | null;
    };
    const planByProduct = new Map<string, Plan>();
    for (const p of (plans ?? []) as Plan[]) {
      // Si hay varias duraciones (renting), nos quedamos con la que coincide
      if (
        parsed.chosen_duration_months &&
        p.duration_months &&
        p.duration_months === parsed.chosen_duration_months
      ) {
        planByProduct.set(p.product_id, p);
      } else if (!planByProduct.has(p.product_id)) {
        planByProduct.set(p.product_id, p);
      }
    }
    for (const it of parsed.items) {
      const p = planByProduct.get(it.product_id);
      if (p?.min_authorized_cents != null && it.unit_price_cents < p.min_authorized_cents) {
        requiresApproval = true;
        break;
      }
    }
  }

  // Mapear total a la columna correcta según plan
  const isCash = parsed.chosen_plan_type === "cash";
  const isRenting = parsed.chosen_plan_type === "renting";
  const isRental = parsed.chosen_plan_type === "rental";

  // Generar reference_code "P-YYYY-NNNN" único por empresa+año.
  // Lo hacemos en código porque la migración no creó trigger todavía.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supaAny = supabase as any;
  const year = new Date().getFullYear();
  const yearPrefix = `P-${year}-`;
  const { data: lastCoded } = await supaAny
    .from("proposals")
    .select("reference_code")
    .eq("company_id", session.company_id)
    .like("reference_code", `${yearPrefix}%`)
    .order("reference_code", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNum = 1;
  const last = (lastCoded as { reference_code: string | null } | null)?.reference_code;
  if (last) {
    const m = last.match(/-(\d+)$/);
    if (m) nextNum = parseInt(m[1]!, 10) + 1;
  }
  const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

  const insertPayload: Record<string, unknown> = {
    company_id: session.company_id,
    customer_id: parsed.customer_id || null,
    lead_id: parsed.lead_id || null,
    reference_code: referenceCode,
    status: requiresApproval ? "pending_approval" : "draft",
    validity_until: parsed.validity_until || null,
    chosen_plan_type: parsed.chosen_plan_type,
    chosen_duration_months: parsed.chosen_duration_months,
    requires_approval: requiresApproval,
    total_cash_cents: isCash ? planTotal : null,
    monthly_renting_min_cents: isRenting ? planTotal : null,
    monthly_rental_cents: isRental ? planTotal : null,
    notes: parsed.notes || null,
    created_by: session.user_id,
    version_number: 1,
  };

  const { data, error } = await supabase
    .from("proposals")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error) throw error;
  const proposalId = (data as { id: string }).id;

  // Snapshot nombres
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
    company_id: session.company_id,
    product_id: it.product_id,
    quantity: it.quantity,
    product_name_snapshot: nameMap.get(it.product_id) ?? "Producto",
    unit_price_cash_cents: it.unit_price_cents,
    installation_included: it.installation_included,
    installation_price_cents: it.installation_included ? null : it.installation_price_cents,
    maintenance_included: it.maintenance_included,
    maintenance_until_date: it.maintenance_included ? it.maintenance_until_date : null,
    maintenance_price_cents: it.maintenance_included ? null : it.maintenance_price_cents,
    maintenance_periodicity_months: it.maintenance_included
      ? null
      : it.maintenance_periodicity_months,
    deposit_cents: isRental ? it.deposit_cents : null,
    charge_first_payment_now: isRental ? it.charge_first_payment_now : false,
    display_order: i,
  }));
  await supabase.from("proposal_items").insert(itemRows);

  await supabase.from("events").insert({
    company_id: session.company_id,
    subject_type: "proposal",
    subject_id: proposalId,
    kind: "proposal.created",
    payload: {
      items: parsed.items.length,
      plan: parsed.chosen_plan_type,
      requires_approval: requiresApproval,
    },
    actor_user_id: session.user_id,
  });

  if (parsed.lead_id) {
    await bumpLeadStatus(parsed.lead_id, "proposal_created");
  }

  // Modo "Contrato directo" (Escenario B): el cliente aceptó las
  // condiciones de palabra. Se acepta la propuesta y se genera el
  // contrato en el mismo paso, saltando aprobación si aplica.
  if (parsed.auto_accept) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Si requiere aprobación, lo flag-eamos como aprobado por nivel 1-2
    // si el actor lo es; si no es nivel 1-2, dejamos en pending_approval
    // y avisamos sin redirigir al contrato.
    const isUpper =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director") ||
      session.roles.includes("telemarketing_director") ||
      session.roles.includes("technical_director");
    if (requiresApproval && !isUpper) {
      // Comercial nivel 3 con precio bajo mínimo. NO podemos saltarnos.
      revalidatePath("/propuestas");
      redirect(`/propuestas/${proposalId}` as never);
    }
    await admin
      .from("proposals")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        ...(requiresApproval
          ? {
              requires_approval: false,
              approved_by: session.user_id,
              approved_at: new Date().toISOString(),
            }
          : {}),
      })
      .eq("id", proposalId);
    await admin.from("events").insert({
      company_id: session.company_id!,
      subject_type: "proposal",
      subject_id: proposalId,
      kind: "proposal.accepted",
      payload: { auto_accept: true },
      actor_user_id: session.user_id,
    });
    // Si la propuesta venía de lead, convertir lead → cliente y mover
    // proposals (mismo flujo que markProposalAccepted).
    let customerIdForContract: string | null = parsed.customer_id ?? null;
    if (parsed.lead_id && !customerIdForContract) {
      try {
        customerIdForContract = await convertLeadToCustomerAction(parsed.lead_id);
        await admin
          .from("proposals")
          .update({ customer_id: customerIdForContract, lead_id: null })
          .eq("id", proposalId);
      } catch {
        /* fall through — el contrato no se podrá generar sin cliente */
      }
    }
    if (customerIdForContract) {
      // Generar contrato. createContractFromProposal hace redirect al
      // detalle del contrato cuando termina, así que no necesitamos otro.
      const { createContractFromProposal } = await import("@/modules/contracts/actions");
      await createContractFromProposal(proposalId);
      // No alcanzamos esta línea — redirect interno
    }
  }

  revalidatePath("/propuestas");
  redirect(`/propuestas/${proposalId}` as never);
}

/**
 * Aprueba una propuesta en estado pending_approval (solo nivel 1/2).
 * Tras aprobar pasa a 'draft' para que el comercial decida cuándo enviarla.
 */
export async function approveProposalAction(id: string): Promise<void> {
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo nivel 1 o 2 puede validar propuestas");
  // Admin client: la policy proposals_update_draft sólo permite UPDATE
  // cuando status='draft'. La propuesta está en pending_approval y el
  // update fallaba silenciosamente — el toast salía pero el estado no
  // cambiaba. Usamos service_role para bypassar RLS aquí.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("proposals")
    .update({
      status: "draft",
      requires_approval: false,
      approved_by: session.user_id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_approval");
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.approved",
    payload: {},
    actor_user_id: session.user_id,
  });
  revalidatePath(`/propuestas/${id}`);
  revalidatePath("/propuestas");
}

/** Rechaza una aprobación. Vuelve a borrador con marca para revisar. */
export async function rejectApprovalAction(id: string, reason?: string): Promise<void> {
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo nivel 1 o 2 puede rechazar aprobaciones");
  // Admin client por la misma razón que approveProposalAction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("proposals")
    .update({
      status: "draft",
      notes: reason ? `[Aprobación rechazada] ${reason}` : null,
    })
    .eq("id", id)
    .eq("status", "pending_approval");
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.approval_rejected",
    payload: { reason: reason ?? null },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/propuestas/${id}`);
}

export async function markProposalSent(id: string) {
  const session = await requireSession();
  // Admin client: la policy proposals_update_draft sólo permite UPDATE
  // cuando status='draft'. Si el flujo se reabre desde sent o pending,
  // o si hay race entre dos comerciales, el UPDATE silente falla.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: prop } = await admin
    .from("proposals")
    .select("lead_id")
    .eq("id", id)
    .single();
  const r = await admin
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
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
  // Admin client: la policy proposals_update_draft sólo permite UPDATE si
  // status='draft'. La propuesta arranca en 'sent' o 'pending_approval' →
  // el UPDATE silente fallaba y el toast salía OK pero seguía sin aceptar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: prop } = await supabase
    .from("proposals")
    .select("id, lead_id, customer_id")
    .eq("id", id)
    .single();
  if (!prop) throw new Error("Propuesta no encontrada");
  const p = prop as {
    id: string;
    lead_id: string | null;
    customer_id: string | null;
  };

  const r1 = await admin
    .from("proposals")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", id);
  if (r1.error) throw new Error(r1.error.message);

  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.accepted",
    payload: {},
    actor_user_id: session.user_id,
  });

  // Si la propuesta era para un lead, supersede las hermanas del MISMO lead
  // y CONVIERTE el lead en cliente directamente para que el flujo sea
  // continuo (acepta → cliente con banner "Generar contrato").
  let customerId: string | null = p.customer_id;
  if (p.lead_id) {
    // Admin: la policy bloquearía las hermanas en sent/pending_approval.
    await admin
      .from("proposals")
      .update({
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_reason: "Otra propuesta del mismo lead aceptada",
        superseded_at: new Date().toISOString(),
        superseded_by_id: id,
      })
      .eq("lead_id", p.lead_id)
      .neq("id", id)
      .in("status", ["draft", "sent", "pending_approval"]);

    // Conversión a cliente en el mismo paso. convertLeadToCustomerAction
    // ya es idempotente: si el lead ya tenía customer, devuelve el id.
    if (!customerId) {
      try {
        customerId = await convertLeadToCustomerAction(p.lead_id);
        // Asegurar que esta propuesta queda vinculada al cliente
        await admin
          .from("proposals")
          .update({ customer_id: customerId, lead_id: null })
          .eq("id", id);
      } catch {
        // Si falla la conversión, dejamos la propuesta como aceptada y
        // el usuario podrá convertir más tarde con el botón "Pasar a
        // contrato". No queremos romper la aceptación por esto.
      }
    }
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
 * Paso explícito "Pasar a contrato" una vez la propuesta está aceptada.
 * Si era para un lead, primero lo convierte a cliente. Devuelve customer_id.
 *
 * El generador de contrato propiamente dicho corre en otro flujo (puede ser
 * inmediato si chosen_plan_type=cash, o una pantalla intermedia para
 * confirmar datos en alquiler/renting).
 */
export async function convertAcceptedProposalToCustomerAction(
  proposalId: string,
): Promise<{ customer_id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: prop } = await supabase
    .from("proposals")
    .select("id, status, lead_id, customer_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (!prop) throw new Error("Propuesta no encontrada");
  const p = prop as {
    id: string;
    status: string;
    lead_id: string | null;
    customer_id: string | null;
  };
  if (p.status !== "accepted") throw new Error("La propuesta debe estar aceptada");

  let customerId = p.customer_id;
  if (!customerId && p.lead_id) {
    // Comprobar si el lead ya tiene customer (caso de versiones anteriores donde
    // markProposalAccepted convertía automáticamente)
    const { data: lead } = await supabase
      .from("leads")
      .select("converted_to_customer_id")
      .eq("id", p.lead_id)
      .maybeSingle();
    const existing = (lead as { converted_to_customer_id: string | null } | null)
      ?.converted_to_customer_id;
    // Admin client: la policy proposals_update_draft bloquea updates a
    // propuestas en estado accepted, así que el move lead→customer falla
    // silenciosamente con el cliente de usuario.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    if (existing) {
      customerId = existing;
      await admin
        .from("proposals")
        .update({ customer_id: customerId, lead_id: null })
        .eq("id", proposalId);
    } else {
      customerId = await convertLeadToCustomerAction(p.lead_id);
      // convertLeadToCustomerAction ya mueve TODAS las propuestas del lead;
      // confirmamos que la nuestra quedó vinculada
      await admin
        .from("proposals")
        .update({ customer_id: customerId, lead_id: null })
        .eq("id", proposalId);
    }
  }
  if (!customerId) throw new Error("No hay cliente asociado");
  revalidatePath(`/propuestas/${proposalId}`);
  revalidatePath(`/clientes/${customerId}`);
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
  const rows = (data ?? []) as ProposalListItem[];
  // Marcar propuestas que ya generaron contrato — para esconder "Generar contrato"
  let withContract = new Set<string>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: cs } = await supabase
      .from("contracts")
      .select("source_proposal_id")
      .in("source_proposal_id", ids)
      .is("deleted_at", null);
    withContract = new Set(
      ((cs ?? []) as { source_proposal_id: string | null }[])
        .map((c) => c.source_proposal_id)
        .filter(Boolean) as string[],
    );
  }
  return rows.map((r) => ({
    ...r,
    customer_or_lead_name: "",
    has_contract: withContract.has(r.id),
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

export async function markProposalRejected(id: string, reason?: string) {
  const session = await requireSession();
  // Admin client: la policy proposals_update_draft sólo permite UPDATE si
  // status='draft'. La propuesta puede estar en 'sent' o 'pending_approval'
  // cuando se rechaza → silent fail con cliente RLS-bound.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const r = await admin
    .from("proposals")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_reason: reason ?? null,
    })
    .eq("id", id);
  if (r.error) throw new Error(r.error.message);
  await admin.from("events").insert({
    company_id: session.company_id!,
    subject_type: "proposal",
    subject_id: id,
    kind: "proposal.rejected",
    payload: { reason: reason ?? null },
    actor_user_id: session.user_id,
  });
  revalidatePath(`/propuestas/${id}`);
}
