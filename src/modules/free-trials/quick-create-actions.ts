"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface OwnerSearchResult {
  kind: "lead" | "customer";
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Búsqueda rápida en leads + customers (filtra por nombre/email/teléfono).
 * Pensada para el selector "lead existente / cliente existente" antes de
 * crear una prueba gratuita.
 */
export async function searchOwners(q: string): Promise<OwnerSearchResult[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const safe = term.replace(/[%_]/g, "");
  const orFilter = [
    `legal_name.ilike.%${safe}%`,
    `trade_name.ilike.%${safe}%`,
    `first_name.ilike.%${safe}%`,
    `last_name.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `phone_primary.ilike.%${safe}%`,
  ].join(",");

  const [{ data: leads }, { data: customers }] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary",
      )
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .or(orFilter)
      .limit(15),
    supabase
      .from("customers")
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary",
      )
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .or(orFilter)
      .limit(15),
  ]);

  function nameOf(p: {
    party_kind?: "individual" | "company";
    trade_name?: string | null;
    legal_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }): string {
    return (
      p.trade_name ||
      p.legal_name ||
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
      "—"
    );
  }

  const leadResults: OwnerSearchResult[] = (leads ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l: any) => ({
      kind: "lead" as const,
      id: l.id,
      display_name: nameOf(l),
      email: l.email,
      phone: l.phone_primary,
    }),
  );
  const customerResults: OwnerSearchResult[] = (customers ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => ({
      kind: "customer" as const,
      id: c.id,
      display_name: nameOf(c),
      email: c.email,
      phone: c.phone_primary,
    }),
  );
  return [...customerResults, ...leadResults].slice(0, 25);
}

/**
 * Crea un lead minimal (sin dirección obligatoria) y devuelve su id +
 * nombre. Pensado para el selector "Crear nuevo lead" del modal de
 * pruebas gratuitas — el comercial completará la ficha después.
 */
export async function createMinimalLeadAction(input: {
  party_kind: "individual" | "company";
  display_name: string;
  email?: string | null;
  phone_primary?: string | null;
}): Promise<
  { ok: true; id: string; name: string } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const name = (input.display_name ?? "").trim();
    if (name.length < 2) return { ok: false, error: "Nombre mínimo 2 caracteres" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const isLevel3 =
      session.roles.includes("sales_rep") ||
      session.roles.includes("telemarketer");
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      party_kind: input.party_kind,
      origin: "other",
      potential: "medium",
      assigned_user_id: isLevel3 ? session.user_id : null,
      assigned_at: isLevel3 ? new Date().toISOString() : null,
      created_by: session.user_id,
      email: input.email?.trim() || null,
      phone_primary: input.phone_primary?.trim() || null,
    };
    if (input.party_kind === "company") {
      payload.trade_name = name;
    } else {
      const parts = name.split(/\s+/);
      payload.first_name = parts[0] ?? name;
      payload.last_name = parts.slice(1).join(" ") || null;
    }
    const { data, error } = await admin
      .from("leads")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
