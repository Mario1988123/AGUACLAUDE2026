"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { normalizeSpanishPhone } from "@/shared/lib/validations/spanish";

export interface ImportCustomerRow {
  party_kind: "individual" | "company";
  legal_name?: string;
  trade_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_primary?: string;
  phone_secondary?: string;
  tax_id?: string;
  notes?: string;
}

export interface ImportResult {
  inserted: number;
  duplicates: number;
  errors: Array<{ row: number; message: string }>;
}

/**
 * Importa clientes. Mismo patrón de dedupe que importLeads. Los clientes ya
 * existentes (mismo phone/email/tax_id) se ignoran.
 */
export async function importCustomersAction(rows: ImportCustomerRow[]): Promise<ImportResult> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director");
  if (!isUpper) throw new Error("Solo admin o director puede importar");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const result: ImportResult = { inserted: 0, duplicates: 0, errors: [] };

  const phones = new Set<string>();
  const emails = new Set<string>();
  const taxIds = new Set<string>();
  for (const r of rows) {
    if (r.phone_primary) {
      phones.add(normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary.trim());
    }
    if (r.email) emails.add(r.email.trim().toLowerCase());
    if (r.tax_id) taxIds.add(r.tax_id.trim().toUpperCase());
  }

  const dupedPhones = new Set<string>();
  const dupedEmails = new Set<string>();
  const dupedTaxIds = new Set<string>();
  for (const table of ["leads", "customers"] as const) {
    if (phones.size > 0) {
      const { data } = await admin
        .from(table)
        .select("phone_primary")
        .eq("company_id", session.company_id)
        .in("phone_primary", Array.from(phones))
        .is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ phone_primary: string | null }>) {
        if (r.phone_primary) dupedPhones.add(r.phone_primary);
      }
    }
    if (emails.size > 0) {
      const { data } = await admin
        .from(table)
        .select("email")
        .eq("company_id", session.company_id)
        .in("email", Array.from(emails))
        .is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ email: string | null }>) {
        if (r.email) dupedEmails.add(r.email.toLowerCase());
      }
    }
    if (taxIds.size > 0) {
      const { data } = await admin
        .from(table)
        .select("tax_id")
        .eq("company_id", session.company_id)
        .in("tax_id", Array.from(taxIds))
        .is("deleted_at", null);
      for (const r of (data ?? []) as Array<{ tax_id: string | null }>) {
        if (r.tax_id) dupedTaxIds.add(r.tax_id.toUpperCase());
      }
    }
  }

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]!;
    try {
      if (r.party_kind === "company" && !r.legal_name?.trim()) {
        result.errors.push({ row: idx + 1, message: "Razón social obligatoria para empresas" });
        continue;
      }
      if (r.party_kind === "individual" && !r.first_name?.trim()) {
        result.errors.push({ row: idx + 1, message: "Nombre obligatorio para particulares" });
        continue;
      }
      const phoneNorm = r.phone_primary
        ? normalizeSpanishPhone(r.phone_primary) ?? r.phone_primary.trim()
        : null;
      const emailNorm = r.email?.trim().toLowerCase() ?? null;
      const taxNorm = r.tax_id?.trim().toUpperCase() ?? null;
      if (
        (phoneNorm && dupedPhones.has(phoneNorm)) ||
        (emailNorm && dupedEmails.has(emailNorm)) ||
        (taxNorm && dupedTaxIds.has(taxNorm))
      ) {
        result.duplicates += 1;
        continue;
      }
      const { error } = await admin.from("customers").insert({
        company_id: session.company_id,
        party_kind: r.party_kind,
        legal_name: r.legal_name || null,
        trade_name: r.trade_name || null,
        first_name: r.first_name || null,
        last_name: r.last_name || null,
        email: emailNorm,
        phone_primary: phoneNorm,
        phone_secondary: r.phone_secondary || null,
        tax_id: taxNorm,
        notes: r.notes || null,
        is_active: true,
        created_by: session.user_id,
      });
      if (error) {
        result.errors.push({ row: idx + 1, message: error.message });
        continue;
      }
      if (phoneNorm) dupedPhones.add(phoneNorm);
      if (emailNorm) dupedEmails.add(emailNorm);
      if (taxNorm) dupedTaxIds.add(taxNorm);
      result.inserted += 1;
    } catch (err) {
      result.errors.push({ row: idx + 1, message: err instanceof Error ? err.message : String(err) });
    }
  }

  revalidatePath("/clientes");
  return result;
}
