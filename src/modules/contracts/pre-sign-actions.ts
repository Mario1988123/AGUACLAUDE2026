"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  validateDNIorNIE,
  validateCIF,
} from "@/shared/lib/validations/spanish";

export interface PreSignReadiness {
  customer: {
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_primary: string | null;
    phone_secondary: string | null;
    tax_id: string | null;
    notes: string | null;
  };
  /** Dirección principal del cliente (la que se usará para instalación) */
  primary_address: {
    id: string;
    street_type: string | null;
    street: string | null;
    street_number: string | null;
    portal: string | null;
    floor: string | null;
    door: string | null;
    postal_code: string | null;
    city: string | null;
    province: string | null;
  } | null;
  /** IBAN principal (puede ser ES00 placeholder) */
  primary_bank: {
    id: string;
    iban: string;
    is_validated: boolean;
    account_holder_name: string | null;
  } | null;
  /** Foto DNI subida al contrato */
  has_id_photo: boolean;
  checks: {
    has_tax_id: boolean;
    tax_id_valid_format: boolean;
    has_email: boolean;
    has_phone: boolean;
    has_address: boolean;
    has_iban: boolean;
    iban_validated: boolean;
    has_id_photo: boolean;
  };
  blockers: string[];
  warnings: string[];
}

/**
 * Devuelve TODA la info necesaria para el modal pre-firma del contrato.
 * Identifica blockers (críticos: no se firma sin esto) y warnings (no
 * bloquean pero conviene completar).
 */
export async function getContractPreSignReadiness(
  contractId: string,
): Promise<PreSignReadiness | null> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: contractRow } = await supabase
    .from("contracts")
    .select("customer_id")
    .eq("id", contractId)
    .maybeSingle();
  const customerId = (contractRow as { customer_id: string | null } | null)?.customer_id;
  if (!customerId) return null;

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, email, phone_primary, phone_secondary, tax_id, notes",
    )
    .eq("id", customerId)
    .single();
  if (!customer) return null;

  // Admin client para leer addresses: la RLS por scope puede ocultar
  // direcciones recién creadas si el usuario no tiene scope full sobre
  // el cliente. El UPSERT también usa admin → coherencia.
  // Buscamos primero la is_primary; si no hay, cogemos la más reciente
  // (por si el flag is_primary no se marcó por race condition o
  // policy en el UPDATE de desmarcar otras).
  const { data: addressPrimary } = await admin
    .from("addresses")
    .select(
      "id, street_type, street, street_number, portal, floor, door, postal_code, city, province",
    )
    .eq("customer_id", customerId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let address = addressPrimary;
  if (!address) {
    const { data: addressAny } = await admin
      .from("addresses")
      .select(
        "id, street_type, street, street_number, portal, floor, door, postal_code, city, province",
      )
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    address = addressAny;
  }

  const { data: bank } = await admin
    .from("customer_bank_accounts")
    .select("id, iban, is_validated, account_holder_name")
    .eq("customer_id", customerId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  const { count: photoCount } = await admin
    .from("contract_photos")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId)
    .eq("kind", "id_card");

  const c = customer as PreSignReadiness["customer"];
  const taxId = (c.tax_id ?? "").trim();
  // Validación según tipo: DNI/NIE para particular comprueba la letra
  // de control; CIF para empresa comprueba formato laxo (no algoritmo
  // estricto, decisión usuario). Antes solo se validaba el regex y se
  // dejaba pasar DNIs con letra incorrecta.
  let taxIdFormatValid = false;
  if (taxId) {
    if (c.party_kind === "company") {
      taxIdFormatValid = validateCIF(taxId);
    } else {
      taxIdFormatValid = validateDNIorNIE(taxId).valid;
    }
  }

  const a = address as PreSignReadiness["primary_address"];
  const hasAddress = Boolean(
    a && a.street && a.postal_code && a.city,
  );

  const b = bank as PreSignReadiness["primary_bank"];

  const checks = {
    has_tax_id: Boolean(taxId),
    tax_id_valid_format: !taxId || taxIdFormatValid,
    has_email: Boolean(c.email),
    has_phone: Boolean(c.phone_primary),
    has_address: hasAddress,
    has_iban: Boolean(b),
    iban_validated: Boolean(b?.is_validated),
    has_id_photo: (photoCount ?? 0) > 0,
  };

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!checks.has_tax_id) blockers.push("DNI/CIF del cliente");
  else if (!checks.tax_id_valid_format) blockers.push("DNI/CIF con formato inválido");
  if (!checks.has_address) blockers.push("Dirección de instalación");
  if (!checks.has_iban) blockers.push("IBAN del cliente (puede ser ES00 pendiente)");

  if (!checks.has_email) warnings.push("Email del cliente");
  if (!checks.has_phone) warnings.push("Teléfono del cliente");
  if (!checks.iban_validated) warnings.push("IBAN sin validar (placeholder ES00)");
  if (!checks.has_id_photo) warnings.push("Foto del DNI/NIE no subida");

  return {
    customer: c,
    primary_address: a,
    primary_bank: b,
    has_id_photo: (photoCount ?? 0) > 0,
    checks,
    blockers,
    warnings,
  };
}
