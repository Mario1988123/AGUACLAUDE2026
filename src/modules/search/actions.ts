"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface SearchHit {
  entity: "lead" | "customer" | "contract" | "proposal" | "installation";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * Búsqueda global por nombre/teléfono/DNI/ref. Limita a 5 resultados por
 * tipo. Sin tablas nuevas, sólo queries paralelas a las existentes.
 */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[%_]/g, "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const [leadsRes, customersRes, contractsRes, proposalsRes, installationsRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, tax_id")
      .is("deleted_at", null)
      .or(
        `legal_name.ilike.%${safe}%,trade_name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone_primary.ilike.%${safe}%,tax_id.ilike.%${safe}%`,
      )
      .limit(5),
    supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, tax_id")
      .is("deleted_at", null)
      .or(
        `legal_name.ilike.%${safe}%,trade_name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone_primary.ilike.%${safe}%,tax_id.ilike.%${safe}%`,
      )
      .limit(5),
    supabase
      .from("contracts")
      .select("id, reference_code, status")
      .is("deleted_at", null)
      .ilike("reference_code", `%${safe}%`)
      .limit(5),
    supabase
      .from("proposals")
      .select("id, reference_code, status")
      .is("deleted_at", null)
      .ilike("reference_code", `%${safe}%`)
      .limit(5),
    supabase
      .from("installations")
      .select("id, reference_code, status")
      .is("deleted_at", null)
      .ilike("reference_code", `%${safe}%`)
      .limit(5),
  ]);

  const hits: SearchHit[] = [];

  function partyName(p: {
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  }): string {
    if (p.party_kind === "company") return p.trade_name || p.legal_name || "—";
    return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
  }

  for (const r of (leadsRes.data ?? []) as Array<{
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_primary: string | null;
    tax_id: string | null;
  }>) {
    hits.push({
      entity: "lead",
      id: r.id,
      title: partyName(r),
      subtitle: [r.tax_id, r.phone_primary].filter(Boolean).join(" · ") || null,
      href: `/leads/${r.id}`,
    });
  }
  for (const r of (customersRes.data ?? []) as Array<{
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_primary: string | null;
    tax_id: string | null;
  }>) {
    hits.push({
      entity: "customer",
      id: r.id,
      title: partyName(r),
      subtitle: [r.tax_id, r.phone_primary].filter(Boolean).join(" · ") || null,
      href: `/clientes/${r.id}`,
    });
  }
  for (const r of (contractsRes.data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status: string;
  }>) {
    hits.push({
      entity: "contract",
      id: r.id,
      title: r.reference_code ?? `#${r.id.slice(0, 8)}`,
      subtitle: r.status,
      href: `/contratos/${r.id}`,
    });
  }
  for (const r of (proposalsRes.data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status: string;
  }>) {
    hits.push({
      entity: "proposal",
      id: r.id,
      title: r.reference_code ?? `#${r.id.slice(0, 8)}`,
      subtitle: r.status,
      href: `/propuestas/${r.id}`,
    });
  }
  for (const r of (installationsRes.data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    status: string;
  }>) {
    hits.push({
      entity: "installation",
      id: r.id,
      title: r.reference_code ?? `#${r.id.slice(0, 8)}`,
      subtitle: r.status,
      href: `/instalaciones/${r.id}`,
    });
  }

  return hits;
}
