import "server-only";

/**
 * Configuración fiscal de la empresa, SIN sesión.
 *
 * Existe aparte de `actions.ts` porque ese fichero es `"use server"`: todo lo
 * que exporte es una server action invocable desde el navegador. Una función
 * que acepta un `company_id` arbitrario no puede vivir ahí — sería regalar el
 * CIF, la dirección y el IBAN de cualquier empresa a cualquier usuario.
 *
 * Quien necesita esto es el cron (no tiene sesión y factura a las cuatro
 * empresas en la misma ejecución). `getFiscalSettings()` de `actions.ts` es
 * ahora un envoltorio que resuelve la empresa desde la sesión y llama aquí.
 */

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
  /** Color hex aplicado a cabeceras y bandas de los PDFs emitidos. */
  pdf_brand_color: string;
  /** Creditor Identifier SEPA. Formato típico ES##ZZZ########## (max 35 chars).
   *  Lo asigna el banco al empresa para domiciliar cuotas con SEPA Core.
   *  Lo usa generateSepaXmlForPendingDebits + el snapshot de cada mandato. */
  sepa_creditor_id: string | null;
  invoice_default_iva: number;
  invoice_default_due_days: number;
  invoice_footer_text: string | null;
}

export const FISCAL_DEFAULTS: FiscalSettings = {
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
  pdf_brand_color: "#4880FF",
  sepa_creditor_id: null,
  invoice_default_iva: 21,
  invoice_default_due_days: 30,
  invoice_footer_text: null,
};

const FISCAL_COLUMNS =
  "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, fiscal_email, fiscal_phone, fiscal_iban, fiscal_mercantile_reg, fiscal_logo_url, pdf_brand_color, sepa_creditor_id, invoice_default_iva, invoice_default_due_days, invoice_footer_text";

export async function loadFiscalSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
): Promise<FiscalSettings> {
  try {
    const { data } = await admin
      .from("company_settings")
      .select(FISCAL_COLUMNS)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return FISCAL_DEFAULTS;
    return { ...FISCAL_DEFAULTS, ...(data as Partial<FiscalSettings>) };
  } catch {
    return FISCAL_DEFAULTS;
  }
}
