"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { validatePhoneWithPrefix } from "@/shared/lib/phone/prefixes";

export interface ReferralItem {
  lead_id: string;
  name: string;
  phone: string | null;
  status: string;
  created_at: string;
  assigned_user_id: string | null;
  referrer_customer_id: string;
}

export interface ReferralGroup {
  customer_id: string;
  customer_name: string;
  count: number;
  referrals: ReferralItem[];
}

type PartyRow = {
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

function nameOf(r: PartyRow, fallback: string): string {
  return r.party_kind === "company"
    ? r.trade_name || r.legal_name || fallback
    : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || fallback;
}

/**
 * Lista los referidos (leads con referred_by_customer_id) agrupados por el
 * cliente que los recomendó. Respeta el scope por rol: nivel 1 todos, nivel 2
 * su equipo, nivel 3 los suyos (por assigned_user_id del lead). Defensivo: si
 * la columna aún no existe (migración sin aplicar) devuelve [].
 */
export async function listReferrals(): Promise<ReferralGroup[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const { resolveVisibleUserIds } = await import("@/shared/lib/auth/role-scope");
  const visibleUserIds = await resolveVisibleUserIds(session);
  if (visibleUserIds && visibleUserIds.length === 0) return [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    let q = supabase
      .from("leads")
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, status, created_at, assigned_user_id, referred_by_customer_id",
      )
      .is("deleted_at", null)
      .not("referred_by_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (visibleUserIds) q = q.in("assigned_user_id", visibleUserIds);
    const { data, error } = await q;
    if (error) return [];
    type Row = PartyRow & {
      id: string;
      phone_primary: string | null;
      status: string;
      created_at: string;
      assigned_user_id: string | null;
      referred_by_customer_id: string;
    };
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];

    // Nombres de los clientes recomendadores
    const custIds = Array.from(new Set(rows.map((r) => r.referred_by_customer_id)));
    const nameMap = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: cs } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("company_id", session.company_id)
      .in("id", custIds);
    for (const c of (cs ?? []) as Array<PartyRow & { id: string }>) {
      nameMap.set(c.id, nameOf(c, "Cliente"));
    }

    const groups = new Map<string, ReferralGroup>();
    for (const r of rows) {
      const cid = r.referred_by_customer_id;
      if (!groups.has(cid)) {
        groups.set(cid, {
          customer_id: cid,
          customer_name: nameMap.get(cid) ?? "Cliente",
          count: 0,
          referrals: [],
        });
      }
      const g = groups.get(cid)!;
      g.count += 1;
      g.referrals.push({
        lead_id: r.id,
        name: nameOf(r, "Sin nombre"),
        phone: r.phone_primary,
        status: r.status,
        created_at: r.created_at,
        assigned_user_id: r.assigned_user_id,
        referrer_customer_id: cid,
      });
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.customer_name.localeCompare(b.customer_name),
    );
  } catch {
    return [];
  }
}

/** Referidos de un cliente concreto (para la ficha del cliente). */
export async function listReferralsByCustomer(
  customerId: string,
): Promise<ReferralItem[]> {
  const session = await requireSession();
  if (!session.company_id || !customerId) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data, error } = await admin
      .from("leads")
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, status, created_at, assigned_user_id",
      )
      .eq("company_id", session.company_id)
      .eq("referred_by_customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) return [];
    type Row = PartyRow & {
      id: string;
      phone_primary: string | null;
      status: string;
      created_at: string;
      assigned_user_id: string | null;
    };
    return ((data ?? []) as Row[]).map((r) => ({
      lead_id: r.id,
      name: nameOf(r, "Sin nombre"),
      phone: r.phone_primary,
      status: r.status,
      created_at: r.created_at,
      assigned_user_id: r.assigned_user_id,
      referrer_customer_id: customerId,
    }));
  } catch {
    return [];
  }
}

/** Devuelve el cliente que recomendó a este lead (o null). Para la ficha del
 *  lead. Defensivo ante columna ausente. */
export async function getLeadReferrer(
  leadId: string,
): Promise<{ customer_id: string; name: string } | null> {
  const session = await requireSession();
  if (!session.company_id || !leadId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: lead, error } = await admin
      .from("leads")
      .select("referred_by_customer_id")
      .eq("id", leadId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (error || !lead) return null;
    const cid = (lead as { referred_by_customer_id: string | null }).referred_by_customer_id;
    if (!cid) return null;
    const { data: cust } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", cid)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!cust) return null;
    return { customer_id: cid, name: nameOf(cust as PartyRow, "Cliente") };
  } catch {
    return null;
  }
}

export interface CustomerHit {
  id: string;
  name: string;
}

/** Busca clientes de la empresa por nombre/teléfono para elegir el recomendador.
 *  Usa RLS (createClient) → respeta el scope del usuario. */
export async function searchReferralCustomersAction(
  query: string,
): Promise<CustomerHit[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  if (!safe) return [];
  const like = `%${safe}%`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .is("deleted_at", null)
    .or(
      [
        `legal_name.ilike.${like}`,
        `trade_name.ilike.${like}`,
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `phone_primary.ilike.${like}`,
      ].join(","),
    )
    .limit(10);
  return ((data ?? []) as Array<PartyRow & { id: string }>).map((c) => ({
    id: c.id,
    name: nameOf(c, "Sin nombre"),
  }));
}

/**
 * Crea un lead REFERIDO asociado a un cliente recomendador. El amigo entra
 * como lead nuevo (origin = referral), asignado a quien lo registra para que
 * un comercial (nivel 3) lo vea en su lista. Verifica que el cliente sea de la
 * empresa.
 */
export async function createReferralLeadAction(input: {
  customer_id: string;
  name: string;
  phone?: string;
  notes?: string;
}): Promise<{ ok: true; lead_id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Usuario sin empresa" };

    const name = (input.name || "").trim();
    if (name.length < 2) return { ok: false, error: "Escribe el nombre del amigo recomendado" };
    const phone = (input.phone || "").trim();
    if (phone && !validatePhoneWithPrefix(phone)) {
      return { ok: false, error: "El teléfono no tiene un formato válido" };
    }
    if (!input.customer_id) return { ok: false, error: "Falta el cliente que recomienda" };

    // Verificar que el cliente es de la empresa.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: cust } = await admin
      .from("customers")
      .select("id")
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cust) return { ok: false, error: "Cliente no encontrado o no pertenece a tu empresa" };

    // Partimos el nombre en nombre/apellidos de forma simple.
    const parts = name.split(/\s+/);
    const firstName = parts.shift() ?? name;
    const lastName = parts.join(" ") || null;

    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      party_kind: "individual",
      first_name: firstName,
      last_name: lastName,
      phone_primary: phone || null,
      origin: "referral",
      potential: "unknown",
      status: "new",
      notes: input.notes?.trim() || null,
      referred_by_customer_id: input.customer_id,
      assigned_user_id: session.user_id,
      assigned_at: new Date().toISOString(),
      created_by: session.user_id,
    };
    const { data, error } = await admin
      .from("leads")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (/referred_by_customer_id|schema cache|Could not find/i.test(error.message ?? "")) {
        return {
          ok: false,
          error: "Falta aplicar la migración de Referidos (referred_by_customer_id).",
        };
      }
      return { ok: false, error: error.message };
    }
    const leadId = (data as { id: string }).id;

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "lead",
      subject_id: leadId,
      kind: "lead.created",
      payload: { origin: "referral", referred_by_customer_id: input.customer_id },
      actor_user_id: session.user_id,
    });

    revalidatePath("/referidos");
    revalidatePath("/leads");
    revalidatePath(`/clientes/${input.customer_id}`);
    return { ok: true, lead_id: leadId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
