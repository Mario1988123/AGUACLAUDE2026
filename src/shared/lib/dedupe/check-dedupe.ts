"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { normalizeSpanishPhone } from "@/shared/lib/validations/spanish";

export interface DedupeMatch {
  field: "tax_id" | "email" | "phone";
  entity: "lead" | "customer";
  id: string;
  display_name: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
}

interface DedupeInput {
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Excluir esta entidad concreta (ej. al editar el propio registro) */
  exclude?: { entity: "lead" | "customer"; id: string };
}

/**
 * Busca duplicados entre leads y customers de la empresa actual.
 * Usa admin client para saltar RLS (un usuario nivel 3 NO ve los leads de otro
 * comercial, pero queremos detectar el duplicado igual). Devolvemos sólo el
 * mínimo de información necesaria para mostrar el aviso.
 */
export async function checkDedupe(input: DedupeInput): Promise<DedupeMatch[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const taxId = input.tax_id?.trim().toUpperCase().replace(/[\s-]/g, "") || null;
  const email = input.email?.trim().toLowerCase() || null;
  const phoneNorm = input.phone ? normalizeSpanishPhone(input.phone) : null;
  const phoneRaw = input.phone?.trim().replace(/[\s\-\.()]/g, "") || null;

  const matches: DedupeMatch[] = [];

  async function searchTable(table: "leads" | "customers"): Promise<void> {
    const conds: string[] = [];
    if (taxId) conds.push(`tax_id.eq.${taxId}`);
    if (email) conds.push(`email.eq.${email}`);
    if (phoneNorm) {
      conds.push(`phone_primary.eq.${phoneNorm}`);
      if (phoneRaw && phoneRaw !== phoneNorm) conds.push(`phone_primary.eq.${phoneRaw}`);
    }
    if (conds.length === 0) return;

    let q = admin
      .from(table)
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary, assigned_user_id",
      )
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .or(conds.join(","));
    if (input.exclude?.entity === (table === "leads" ? "lead" : "customer")) {
      q = q.neq("id", input.exclude.id);
    }
    const { data } = await q;
    type Row = {
      id: string;
      party_kind: "individual" | "company";
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      tax_id: string | null;
      email: string | null;
      phone_primary: string | null;
      assigned_user_id: string | null;
    };
    const rows = (data ?? []) as Row[];
    for (const r of rows) {
      const display =
        r.party_kind === "company"
          ? r.trade_name || r.legal_name || "Sin nombre"
          : `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Sin nombre";
      const matchedFields: DedupeMatch["field"][] = [];
      if (taxId && r.tax_id?.toUpperCase() === taxId) matchedFields.push("tax_id");
      if (email && r.email?.toLowerCase() === email) matchedFields.push("email");
      if (
        (phoneNorm && r.phone_primary === phoneNorm) ||
        (phoneRaw && r.phone_primary === phoneRaw)
      ) {
        matchedFields.push("phone");
      }
      for (const f of matchedFields) {
        matches.push({
          field: f,
          entity: table === "leads" ? "lead" : "customer",
          id: r.id,
          display_name: display,
          assigned_user_id: r.assigned_user_id,
          assigned_user_name: null,
        });
      }
    }
  }

  await Promise.all([searchTable("leads"), searchTable("customers")]);

  // Resolver nombres de comerciales asignados
  const userIds = Array.from(
    new Set(matches.map((m) => m.assigned_user_id).filter((v): v is string => !!v)),
  );
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    const nameMap = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? "");
    }
    for (const m of matches) {
      if (m.assigned_user_id) {
        m.assigned_user_name = nameMap.get(m.assigned_user_id) ?? null;
      }
    }
  }

  return matches;
}
