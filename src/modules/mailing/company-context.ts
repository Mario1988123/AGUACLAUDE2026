/**
 * Contexto de empresa para construir emails: datos legales del footer (LSSI)
 * + branding visual (logo + color de marca). Se usa en todos los puntos que
 * llaman a buildEmailHtml para que el diseño sea consistente sin duplicar la
 * consulta a company_settings/companies en cada caller.
 *
 * NO lleva "use server": es un helper de servidor importado por actions, crons
 * y server components. No debe importarse desde un componente cliente.
 */
import type { EmailBranding } from "./templates";

export interface CompanyEmailContext {
  company: {
    legal_name: string;
    tax_id: string;
    address: string | null;
    email: string | null;
    phone: string | null;
  };
  branding: EmailBranding;
}

/**
 * Carga datos fiscales + branding de la empresa. El logo y el color se toman
 * primero de los campos fiscales (los que el admin configura para PDFs) y, si
 * faltan, de la tabla companies. Fail-soft: si algo falla, devuelve neutro.
 */
export async function loadCompanyEmailContext(
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<CompanyEmailContext> {
  let cs: Record<string, string | null> = {};
  let comp: Record<string, string | null> = {};
  try {
    const { data } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_email, fiscal_phone, fiscal_logo_url, pdf_brand_color",
      )
      .eq("company_id", companyId)
      .maybeSingle();
    cs = (data ?? {}) as Record<string, string | null>;
  } catch {
    /* fail-soft */
  }
  try {
    const { data } = await admin
      .from("companies")
      .select("name, logo_url, primary_color")
      .eq("id", companyId)
      .maybeSingle();
    comp = (data ?? {}) as Record<string, string | null>;
  } catch {
    /* fail-soft */
  }

  const legalName = cs.fiscal_legal_name || comp.name || "—";
  return {
    company: {
      legal_name: legalName,
      tax_id: cs.fiscal_tax_id || "—",
      address: cs.fiscal_street ?? null,
      email: cs.fiscal_email ?? null,
      phone: cs.fiscal_phone ?? null,
    },
    branding: {
      company_name: legalName,
      logo_url: cs.fiscal_logo_url || comp.logo_url || null,
      brand_color: cs.pdf_brand_color || comp.primary_color || null,
    },
  };
}
