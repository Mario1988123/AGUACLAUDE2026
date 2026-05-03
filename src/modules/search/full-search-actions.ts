"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import type { SearchHit } from "./actions";
import { SEARCH_PAGE_SIZE as PAGE_SIZE } from "./constants";

/**
 * Búsqueda completa por entidad con paginación. Para la página /buscar.
 */
export async function searchByEntity(
  entity: "lead" | "customer" | "contract" | "proposal" | "installation",
  query: string,
  page: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const session = await requireSession();
  if (!session.company_id || !query || query.length < 2) {
    return { hits: [], total: 0 };
  }
  const safe = query.replace(/[%_]/g, "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

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

  if (entity === "lead" || entity === "customer") {
    const table = entity === "lead" ? "leads" : "customers";
    const { data, count } = await supabase
      .from(table)
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary, tax_id, email",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .or(
        `legal_name.ilike.%${safe}%,trade_name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone_primary.ilike.%${safe}%,tax_id.ilike.%${safe}%,email.ilike.%${safe}%`,
      )
      .range(from, to);
    type Row = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone_primary: string | null;
      tax_id: string | null;
      email: string | null;
    };
    const hits: SearchHit[] = ((data ?? []) as Row[]).map((r) => ({
      entity,
      id: r.id,
      title: partyName(r),
      subtitle:
        [r.tax_id, r.phone_primary, r.email].filter(Boolean).join(" · ") || null,
      href: entity === "lead" ? `/leads/${r.id}` : `/clientes/${r.id}`,
    }));
    return { hits, total: count ?? hits.length };
  }

  // contract / proposal / installation: buscar por reference_code
  const tableMap = {
    contract: "contracts",
    proposal: "proposals",
    installation: "installations",
  } as const;
  const hrefMap = {
    contract: "/contratos",
    proposal: "/propuestas",
    installation: "/instalaciones",
  } as const;
  const table = tableMap[entity];
  const { data, count } = await supabase
    .from(table)
    .select("id, reference_code, status", { count: "exact" })
    .is("deleted_at", null)
    .ilike("reference_code", `%${safe}%`)
    .range(from, to);
  type Row = { id: string; reference_code: string | null; status: string };
  const hits: SearchHit[] = ((data ?? []) as Row[]).map((r) => ({
    entity,
    id: r.id,
    title: r.reference_code ?? `#${r.id.slice(0, 8)}`,
    subtitle: r.status,
    href: `${hrefMap[entity]}/${r.id}`,
  }));
  return { hits, total: count ?? hits.length };
}

