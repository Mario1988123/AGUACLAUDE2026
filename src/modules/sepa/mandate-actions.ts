"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface SepaMandate {
  id: string;
  umr: string;
  scheme: "core" | "b2b";
  status: "draft" | "active" | "cancelled" | "expired";
  debtor_name: string;
  debtor_tax_id: string | null;
  debtor_iban: string;
  debtor_bic: string | null;
  creditor_id: string;
  creditor_name: string;
  is_recurring: boolean;
  signed_at: string | null;
  signed_place: string | null;
  signature_image_path: string | null;
  pdf_document_id: string | null;
  last_used_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

/**
 * Devuelve el mandato SEPA del contrato (si existe).
 */
export async function getSepaMandateByContract(
  contractId: string,
): Promise<SepaMandate | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("sepa_mandates")
      .select(
        "id, umr, scheme, status, debtor_name, debtor_tax_id, debtor_iban, debtor_bic, creditor_id, creditor_name, is_recurring, signed_at, signed_place, signature_image_path, pdf_document_id, last_used_at, cancelled_at, cancellation_reason, created_at",
      )
      .eq("contract_id", contractId)
      .eq("company_id", session.company_id)
      .maybeSingle();
    return (data as SepaMandate | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Genera UMR único para un mandato. Formato: AGCL-YYYYMM-XXXXXX (max 35).
 */
function generateUmr(): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AGCL-${yyyymm}-${rand}`;
}

const createSchema = z.object({
  contract_id: z.string().uuid(),
  scheme: z.enum(["core", "b2b"]).default("core"),
});

/**
 * Crea (idempotente) un mandato SEPA en estado 'draft' para un contrato.
 * Snapshotea los datos del deudor (cliente) y del acreedor (empresa)
 * en el momento de la creación. Validaciones:
 *  · Contrato debe ser rental/renting con payment_method_recurring='direct_debit'.
 *  · Cliente debe tener IBAN válido (no ES00).
 *  · Empresa debe tener sepa_creditor_id configurado.
 *  · Si ya hay mandato para el contrato, devuelve el existente.
 */
export async function createSepaMandateAction(
  input: unknown,
): Promise<{ ok: true; mandate_id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Solo admin o director comercial" };
    const parsed = parseOrFriendly(createSchema, input, "Mandato SEPA");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Idempotencia
    const { data: existing } = await admin
      .from("sepa_mandates")
      .select("id, status")
      .eq("contract_id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (existing) {
      return { ok: true, mandate_id: (existing as { id: string }).id };
    }

    // Validar contrato
    const { data: contract } = await admin
      .from("contracts")
      .select(
        "id, customer_id, plan_type, payment_method_recurring, reference_code",
      )
      .eq("id", parsed.contract_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!contract) return { ok: false, error: "Contrato no encontrado" };
    const c = contract as {
      id: string;
      customer_id: string | null;
      plan_type: string;
      payment_method_recurring: string | null;
      reference_code: string | null;
    };
    if (c.plan_type !== "rental" && c.plan_type !== "renting") {
      return {
        ok: false,
        error: "El mandato SEPA solo aplica a contratos de alquiler o renting.",
      };
    }
    if (c.payment_method_recurring !== "direct_debit") {
      return {
        ok: false,
        error:
          "El contrato no está marcado como domiciliación. Cambia la forma de pago a 'domiciliación SEPA' antes de generar el mandato.",
      };
    }
    if (!c.customer_id) return { ok: false, error: "Contrato sin cliente" };

    // Cliente
    const { data: customer } = await admin
      .from("customers")
      .select("id, legal_name, trade_name, first_name, last_name, party_kind, tax_id")
      .eq("id", c.customer_id)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Cliente no encontrado" };
    const cust = customer as {
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      party_kind: "individual" | "company";
      tax_id: string | null;
    };
    const debtorName =
      cust.party_kind === "company"
        ? cust.trade_name || cust.legal_name || ""
        : `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim();
    if (!debtorName)
      return { ok: false, error: "Cliente sin nombre/razón social." };

    // IBAN
    const { data: bank } = await admin
      .from("customer_bank_accounts")
      .select("iban, bic")
      .eq("customer_id", c.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    const b = bank as { iban: string | null; bic: string | null } | null;
    const iban = (b?.iban ?? "").replace(/\s+/g, "").toUpperCase();
    if (!iban || /^ES00/.test(iban) || !/^ES\d{2}[\dA-Z]{20}$/.test(iban)) {
      return {
        ok: false,
        error:
          "El IBAN del cliente no es válido (vacío, ES00 o formato incorrecto). Corrígelo antes de generar el mandato.",
      };
    }

    // Dirección
    const { data: address } = await admin
      .from("addresses")
      .select("street_type, street, street_number, postal_code, city, province")
      .eq("customer_id", c.customer_id)
      .eq("is_primary", true)
      .maybeSingle();
    let debtorAddress: string | null = null;
    if (address) {
      const a = address as {
        street_type: string | null;
        street: string | null;
        street_number: string | null;
        postal_code: string | null;
        city: string | null;
        province: string | null;
      };
      const parts = [
        `${a.street_type ?? ""} ${a.street ?? ""}`.trim(),
        a.street_number,
        a.postal_code,
        a.city,
        a.province,
      ].filter(Boolean);
      debtorAddress = parts.join(", ");
    }

    // Acreedor (empresa)
    const { data: cs } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_trade_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, sepa_creditor_id",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const cset = cs as {
      fiscal_legal_name: string | null;
      fiscal_trade_name: string | null;
      fiscal_tax_id: string | null;
      fiscal_street: string | null;
      fiscal_postal_code: string | null;
      fiscal_city: string | null;
      fiscal_province: string | null;
      sepa_creditor_id: string | null;
    } | null;
    if (!cset?.sepa_creditor_id) {
      return {
        ok: false,
        error:
          "Falta el identificador SEPA del acreedor (CID) en /configuracion/fiscal. Sin él no se puede generar el mandato.",
      };
    }
    const creditorName =
      cset.fiscal_trade_name || cset.fiscal_legal_name || "Empresa";
    const creditorAddress = [
      cset.fiscal_street,
      cset.fiscal_postal_code,
      cset.fiscal_city,
      cset.fiscal_province,
    ]
      .filter(Boolean)
      .join(", ");

    // INSERT
    const umr = generateUmr();
    const { data: inserted, error } = await admin
      .from("sepa_mandates")
      .insert({
        company_id: session.company_id,
        contract_id: c.id,
        customer_id: c.customer_id,
        umr,
        scheme: parsed.scheme,
        status: "draft",
        debtor_name: debtorName,
        debtor_tax_id: cust.tax_id,
        debtor_iban: iban,
        debtor_bic: b?.bic ?? null,
        debtor_address: debtorAddress,
        creditor_id: cset.sepa_creditor_id,
        creditor_name: creditorName,
        creditor_address: creditorAddress || null,
        is_recurring: true,
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/contratos/${c.id}`);
    return { ok: true, mandate_id: (inserted as { id: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

const signSchema = z.object({
  mandate_id: z.string().uuid(),
  /** data URL base64 (image/png) o ruta de storage. Aceptamos ambos. */
  signature_image_path: z.string().min(1),
  signed_place: z.string().trim().min(1).max(120),
});

// NOTA: signature_image_path acepta un data URL base64 inline igual que
// hace contract_signatures.signature_data_url — así evitamos depender
// de Supabase Storage para una firma puntual.

/**
 * Marca el mandato como firmado: guarda la imagen de firma, fecha,
 * lugar e IP. Pasa el mandato a 'active'.
 */
export async function signSepaMandateAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(signSchema, input, "Firma mandato");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: m } = await admin
      .from("sepa_mandates")
      .select("id, status, contract_id, company_id")
      .eq("id", parsed.mandate_id)
      .maybeSingle();
    if (!m) return { ok: false, error: "Mandato no encontrado" };
    const mandate = m as {
      id: string;
      status: string;
      contract_id: string;
      company_id: string;
    };
    if (mandate.company_id !== session.company_id)
      return { ok: false, error: "Otra empresa" };
    if (mandate.status !== "draft") {
      return {
        ok: false,
        error: `El mandato no está en borrador (estado: ${mandate.status})`,
      };
    }

    const r = await admin
      .from("sepa_mandates")
      .update({
        status: "active",
        signed_at: new Date().toISOString(),
        signed_place: parsed.signed_place,
        signature_image_path: parsed.signature_image_path,
      })
      .eq("id", parsed.mandate_id);
    if (r.error) return { ok: false, error: r.error.message };

    revalidatePath(`/contratos/${mandate.contract_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Actualiza la forma de pago de cuotas recurrentes del contrato.
 * direct_debit (default, SEPA) | transfer (cliente transfiere manual).
 */
const paymentMethodSchema = z.object({
  contract_id: z.string().uuid(),
  method: z.enum(["direct_debit", "transfer"]),
});

export async function updateContractRecurringPaymentMethodAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Solo admin o director comercial" };
    const parsed = parseOrFriendly(paymentMethodSchema, input, "Forma de pago");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("contracts")
      .update({ payment_method_recurring: parsed.method })
      .eq("id", parsed.contract_id)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath(`/contratos/${parsed.contract_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
