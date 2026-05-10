"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  validateDNIorNIE,
  validateCIF,
} from "@/shared/lib/validations/spanish";

export interface PreSignReadiness {
  /** Tipo de plan del contrato. cash=al contado (no requiere IBAN);
   *  rental=alquiler con cuotas; renting=renting. */
  plan_type: "cash" | "rental" | "renting" | null;
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
  const session = await requireSession();
  const isLevel1 =
    session.is_superadmin || session.roles.includes("company_admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: contractRow } = await supabase
    .from("contracts")
    .select("customer_id, plan_type")
    .eq("id", contractId)
    .maybeSingle();
  const cr = contractRow as {
    customer_id: string | null;
    plan_type: "cash" | "rental" | "renting" | null;
  } | null;
  const customerId = cr?.customer_id;
  const planType = cr?.plan_type ?? null;
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

  let photoCount = 0;
  try {
    const r = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", "contract")
      .eq("subject_id", contractId)
      .eq("kind", "contract.id_card")
      .is("deleted_at", null);
    if (!r.error) photoCount = r.count ?? 0;
  } catch (e) {
    console.error("[pre-sign-actions] photo count failed:", e);
  }

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

  let b = bank as PreSignReadiness["primary_bank"];
  // Niveles distintos a admin solo ven los últimos 4 dígitos del IBAN
  // por privacidad. Pueden confirmar al cliente sus 4 últimos si pregunta.
  if (b && !isLevel1) {
    const clean = b.iban.replace(/\s/g, "");
    const masked =
      clean.length > 8
        ? clean.slice(0, 4) + "*".repeat(clean.length - 8) + clean.slice(-4)
        : clean;
    b = { ...b, iban: masked };
  }

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

  // Reglas de firma según plan (decisión usuario 2026-05-08):
  //  - Contado (cash):  sin DNI, sin IBAN, sin dirección obligatorios.
  //                     Solo firma. DNI = warning, no bloquea.
  //  - Alquiler/Renting: IBAN obligatorio (puede ser ES00 → pending_data).
  //                     DNI = warning, no bloquea. Dirección obligatoria
  //                     porque hay que ir a instalar.
  const blockers: string[] = [];
  const warnings: string[] = [];
  const ibanRequired = planType === "rental" || planType === "renting";

  // DNI: SIEMPRE warning (nunca bloquea, para ningún plan)
  if (!checks.has_tax_id) warnings.push("DNI/CIF del cliente (recomendado)");
  else if (!checks.tax_id_valid_format) warnings.push("DNI/CIF con formato inválido");

  // Dirección: obligatoria en alquiler/renting (hay que instalar)
  if (ibanRequired && !checks.has_address) {
    blockers.push("Dirección de instalación");
  }

  // IBAN: obligatorio en alquiler/renting. Acepta ES00 (pending_data).
  if (ibanRequired && !checks.has_iban) {
    blockers.push("IBAN del cliente (puede ser ES00 pendiente)");
  }

  if (!checks.has_email) warnings.push("Email del cliente");
  if (!checks.has_phone) warnings.push("Teléfono del cliente");
  if (ibanRequired && !checks.iban_validated && checks.has_iban) {
    warnings.push("IBAN pendiente (ES00) — completa cuando lo tengas");
  }
  if (!checks.has_id_photo) warnings.push("Foto del DNI/NIE no subida");

  return {
    plan_type: planType,
    customer: c,
    primary_address: a,
    primary_bank: b,
    has_id_photo: (photoCount ?? 0) > 0,
    checks,
    blockers,
    warnings,
  };
}
