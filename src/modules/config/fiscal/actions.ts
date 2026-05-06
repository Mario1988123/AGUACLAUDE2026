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

/**
 * Persiste la configuración fiscal de la empresa. Antes hacía UPDATE
 * sin comprobar error: si la migración 20260503300000_company_fiscal
 * no estaba aplicada (columnas fiscal_* inexistentes), el UPDATE
 * silenciosamente fallaba y el usuario creía que se guardaba el IBAN
 * cuando NO se persistía nada.
 *
 * Ahora:
 *  - Verifica errores en cada operación.
 *  - Si una columna no existe, la quita del payload y reintenta para
 *    no perder el resto de cambios. Devuelve la lista de columnas
 *    omitidas en un Error explícito (visible en toast) para que el
 *    usuario sepa qué migración aplicar.
 *  - Devuelve el snapshot guardado para que el form rehidrate sin
 *    suposiciones.
 */
export async function updateFiscalSettingsAction(
  input: Partial<FiscalSettings>,
): Promise<{ saved: Partial<FiscalSettings>; skipped: string[] }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: existing, error: selErr } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (selErr) {
    console.error("[updateFiscal] SELECT failed:", selErr.message);
    throw new Error(`No se pudo leer company_settings: ${selErr.message}`);
  }

  // Trabajamos sobre una copia mutable del payload
  const payload: Record<string, unknown> = { ...input };
  const skipped: string[] = [];

  async function attempt(): Promise<{ error: { message: string } | null }> {
    if (existing) {
      return await admin
        .from("company_settings")
        .update(payload)
        .eq("company_id", session.company_id);
    }
    return await admin.from("company_settings").insert({
      company_id: session.company_id,
      ...payload,
    });
  }

  // Hasta 20 reintentos quitando columnas inexistentes una a una.
  for (let i = 0; i < 20; i++) {
    const r = await attempt();
    if (!r.error) break;
    const msg = r.error.message ?? "";
    const m =
      msg.match(/column "?([a-z_]+)"? .* does not exist/i) ??
      msg.match(/'([a-z_]+)' column .* schema cache/i) ??
      msg.match(/Could not find the '([a-z_]+)' column/i);
    if (m && m[1] && m[1] in payload) {
      console.error(
        `[updateFiscal] columna ${m[1]} no existe — la omito y reintento`,
      );
      skipped.push(m[1]);
      delete payload[m[1]];
      if (Object.keys(payload).length === 0) break;
      continue;
    }
    console.error("[updateFiscal] write failed:", msg);
    throw new Error(`No se pudo guardar: ${msg}`);
  }

  if (skipped.length > 0) {
    // Aviso claro al usuario para que vea qué columnas faltan en BD.
    throw new Error(
      `Datos guardados parcialmente. Columnas no aplicadas en BD: ${skipped.join(", ")}. Aplica la migración 20260503300000_company_fiscal.sql.`,
    );
  }

  revalidatePath("/configuracion/fiscal");
  return { saved: payload as Partial<FiscalSettings>, skipped };
}
