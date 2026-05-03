"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface FiscalSettings {
  fiscal_legal_name: string | null;
  fiscal_tax_id: string | null;
  fiscal_street: string | null;
  fiscal_postal_code: string | null;
  fiscal_city: string | null;
  fiscal_province: string | null;
  fiscal_country: string;
  fiscal_email: string | null;
  fiscal_phone: string | null;
  fiscal_iban: string | null;
  fiscal_mercantile_reg: string | null;
  fiscal_logo_url: string | null;
  invoice_default_iva: number;
  invoice_default_due_days: number;
  invoice_footer_text: string | null;
}

const DEFAULTS: FiscalSettings = {
  fiscal_legal_name: null,
  fiscal_tax_id: null,
  fiscal_street: null,
  fiscal_postal_code: null,
  fiscal_city: null,
  fiscal_province: null,
  fiscal_country: "España",
  fiscal_email: null,
  fiscal_phone: null,
  fiscal_iban: null,
  fiscal_mercantile_reg: null,
  fiscal_logo_url: null,
  invoice_default_iva: 21,
  invoice_default_due_days: 30,
  invoice_footer_text: null,
};

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export async function getFiscalSettings(): Promise<FiscalSettings> {
  try {
    const session = await requireSession();
    if (!session.company_id) return DEFAULTS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, fiscal_email, fiscal_phone, fiscal_iban, fiscal_mercantile_reg, fiscal_logo_url, invoice_default_iva, invoice_default_due_days, invoice_footer_text",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return { ...DEFAULTS, ...(data as Partial<FiscalSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export async function updateFiscalSettingsAction(input: Partial<FiscalSettings>): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (existing) {
    await admin
      .from("company_settings")
      .update(input)
      .eq("company_id", session.company_id);
  } else {
    await admin.from("company_settings").insert({
      company_id: session.company_id,
      ...input,
    });
  }
  revalidatePath("/configuracion/fiscal");
}
