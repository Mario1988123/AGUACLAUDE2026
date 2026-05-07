"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  type Environment,
  type GoCardlessConfig,
  cancelMandate as gcCancelMandate,
  completeRedirectFlow,
  createPayment as gcCreatePayment,
  createRedirectFlow,
  getBankAccount,
  getMandate,
} from "./client";

interface SettingsRow {
  company_id: string;
  environment: Environment;
  access_token: string;
  webhook_secret: string | null;
  enabled: boolean;
  organisation_id: string | null;
}

async function getSettingsForCompany(companyId: string): Promise<SettingsRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("gocardless_settings")
    .select("company_id, environment, access_token, webhook_secret, enabled, organisation_id")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as SettingsRow | null) ?? null;
}

function settingsToConfig(s: SettingsRow): GoCardlessConfig {
  return { accessToken: s.access_token, environment: s.environment };
}

export async function getGoCardlessSettings(): Promise<{
  configured: boolean;
  environment: Environment | null;
  enabled: boolean;
  hasWebhookSecret: boolean;
}> {
  const session = await requireSession();
  if (!session.company_id) return { configured: false, environment: null, enabled: false, hasWebhookSecret: false };
  const s = await getSettingsForCompany(session.company_id);
  if (!s) return { configured: false, environment: null, enabled: false, hasWebhookSecret: false };
  return {
    configured: true,
    environment: s.environment,
    enabled: s.enabled,
    hasWebhookSecret: !!s.webhook_secret,
  };
}

export async function saveGoCardlessSettingsAction(input: {
  environment: Environment;
  access_token: string;
  webhook_secret?: string;
  enabled?: boolean;
}) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    throw new Error("Solo admin");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const existing = await getSettingsForCompany(session.company_id);
  const keepToken = input.access_token === "__keep__";
  const newToken = keepToken ? existing?.access_token : input.access_token;
  if (!newToken || newToken.length < 20) {
    throw new Error("Access token GoCardless inválido");
  }
  const keepSecret = input.webhook_secret === undefined || input.webhook_secret === "";
  const payload: Record<string, unknown> = {
    company_id: session.company_id,
    environment: input.environment,
    access_token: newToken,
    webhook_secret: keepSecret ? existing?.webhook_secret ?? null : input.webhook_secret,
    enabled: input.enabled ?? true,
  };
  const { error } = await admin
    .from("gocardless_settings")
    .upsert(payload, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/configuracion/gocardless");
}

/**
 * Crea un redirect flow para que el cliente firme un mandato.
 * Devuelve la URL a la que redirigir al cliente.
 */
export async function createMandateRedirectFlowAction(input: {
  customer_id: string;
  return_path?: string;     // Path interno al que volver tras firmar
}): Promise<{ redirect_url: string; flow_db_id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const settings = await getSettingsForCompany(session.company_id);
  if (!settings || !settings.enabled) throw new Error("GoCardless no configurado");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cust } = await admin
    .from("customers")
    .select("id, name, email, address_street, address_city, address_postal_code")
    .eq("id", input.customer_id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const customer = cust as
    | {
        id: string;
        name: string;
        email: string | null;
        address_street: string | null;
        address_city: string | null;
        address_postal_code: string | null;
      }
    | null;
  if (!customer) throw new Error("Cliente no encontrado");

  const sessionToken = crypto.randomBytes(24).toString("hex");
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const successRedirectUrl = `${baseUrl}/api/gocardless/callback?session_token=${sessionToken}&return_path=${encodeURIComponent(input.return_path ?? `/clientes/${customer.id}`)}`;

  const [given, ...rest] = customer.name.split(" ");
  const family = rest.join(" ").trim() || given;
  const flow = await createRedirectFlow(settingsToConfig(settings), {
    description: `Domiciliación bancaria — ${customer.name}`,
    sessionToken,
    successRedirectUrl,
    customer: {
      given_name: given,
      family_name: family,
      email: customer.email ?? undefined,
      address_line1: customer.address_street ?? undefined,
      city: customer.address_city ?? undefined,
      postal_code: customer.address_postal_code ?? undefined,
      country_code: "ES",
    },
  });

  const { data: dbFlow, error } = await admin
    .from("gocardless_redirect_flows")
    .insert({
      company_id: session.company_id,
      customer_id: customer.id,
      gocardless_redirect_flow_id: flow.id,
      redirect_url: flow.redirect_url,
      session_token: sessionToken,
      status: "created",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return {
    redirect_url: flow.redirect_url,
    flow_db_id: (dbFlow as { id: string }).id,
  };
}

/**
 * Tras volver del redirect, completa el flow y persiste el mandato.
 * Llamado desde el endpoint /api/gocardless/callback.
 */
export async function completeRedirectFlowAndCreateMandate(input: {
  redirect_flow_id: string;
  session_token: string;
}): Promise<{ mandate_db_id: string; customer_id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("gocardless_redirect_flows")
    .select("id, company_id, customer_id, session_token, status")
    .eq("gocardless_redirect_flow_id", input.redirect_flow_id)
    .maybeSingle();
  const flow = row as
    | {
        id: string;
        company_id: string;
        customer_id: string;
        session_token: string;
        status: string;
      }
    | null;
  if (!flow) throw new Error("Flow no encontrado");
  if (flow.session_token !== input.session_token) throw new Error("Session token inválido");

  const settings = await getSettingsForCompany(flow.company_id);
  if (!settings) throw new Error("Empresa sin GoCardless");

  const completed = await completeRedirectFlow(
    settingsToConfig(settings),
    input.redirect_flow_id,
    input.session_token,
  );
  if (!completed.links.mandate) throw new Error("No se generó mandato");

  // Pull mandato + bank account
  const mandate = await getMandate(settingsToConfig(settings), completed.links.mandate);
  let iban_last4: string | null = null;
  let account_holder_name: string | null = null;
  let bank_name: string | null = null;
  try {
    const bank = await getBankAccount(settingsToConfig(settings), mandate.links.customer_bank_account);
    iban_last4 = bank.account_number_ending;
    account_holder_name = bank.account_holder_name;
    bank_name = bank.bank_name;
  } catch {
    /* no-op */
  }

  const { data: m, error } = await admin
    .from("gocardless_mandates")
    .insert({
      company_id: flow.company_id,
      customer_id: flow.customer_id,
      gocardless_mandate_id: mandate.id,
      gocardless_customer_id: mandate.links.customer,
      gocardless_bank_account_id: mandate.links.customer_bank_account,
      scheme: mandate.scheme,
      status: mandate.status,
      reference: mandate.reference,
      iban_last4,
      account_holder_name,
      bank_name,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await admin
    .from("gocardless_redirect_flows")
    .update({
      status: "completed",
      mandate_id: (m as { id: string }).id,
      completed_at: new Date().toISOString(),
    })
    .eq("id", flow.id);

  revalidatePath(`/clientes/${flow.customer_id}`);
  return { mandate_db_id: (m as { id: string }).id, customer_id: flow.customer_id };
}

export interface MandateListRow {
  id: string;
  gocardless_mandate_id: string;
  status: string;
  iban_last4: string | null;
  bank_name: string | null;
  created_at: string;
}

export async function listCustomerMandates(customerId: string): Promise<MandateListRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("gocardless_mandates")
    .select("id, gocardless_mandate_id, status, iban_last4, bank_name, created_at")
    .eq("company_id", session.company_id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return ((data as MandateListRow[] | null) ?? []);
}

export async function cancelMandateAction(mandateDbId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: m } = await admin
    .from("gocardless_mandates")
    .select("id, gocardless_mandate_id, customer_id, company_id")
    .eq("id", mandateDbId)
    .maybeSingle();
  const mandate = m as
    | { id: string; gocardless_mandate_id: string; customer_id: string; company_id: string }
    | null;
  if (!mandate) throw new Error("Mandato no encontrado");
  if (mandate.company_id !== session.company_id) throw new Error("Otra empresa");
  const settings = await getSettingsForCompany(mandate.company_id);
  if (!settings) throw new Error("GoCardless no configurado");
  const cancelled = await gcCancelMandate(settingsToConfig(settings), mandate.gocardless_mandate_id);
  await admin
    .from("gocardless_mandates")
    .update({ status: cancelled.status, cancelled_at: new Date().toISOString() })
    .eq("id", mandate.id);
  revalidatePath(`/clientes/${mandate.customer_id}`);
}

/**
 * Crea un cobro GoCardless contra un mandato activo y materializa un
 * wallet_entry pending que se validará cuando el webhook confirme.
 */
export async function createPaymentAction(input: {
  mandate_id: string;          // DB id
  amount_cents: number;
  description: string;
  contract_id?: string | null;
  invoice_id?: string | null;
  contract_payment_id?: string | null;
}): Promise<{ payment_db_id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (input.amount_cents <= 0) throw new Error("Importe inválido");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: m } = await admin
    .from("gocardless_mandates")
    .select("id, gocardless_mandate_id, customer_id, status, company_id")
    .eq("id", input.mandate_id)
    .maybeSingle();
  const mandate = m as
    | {
        id: string;
        gocardless_mandate_id: string;
        customer_id: string;
        status: string;
        company_id: string;
      }
    | null;
  if (!mandate) throw new Error("Mandato no encontrado");
  if (mandate.company_id !== session.company_id) throw new Error("Otra empresa");
  if (!["active", "submitted", "pending_submission"].includes(mandate.status)) {
    throw new Error(`Mandato no activo (estado: ${mandate.status})`);
  }
  const settings = await getSettingsForCompany(mandate.company_id);
  if (!settings || !settings.enabled) throw new Error("GoCardless deshabilitado");

  const payment = await gcCreatePayment(settingsToConfig(settings), {
    mandateId: mandate.gocardless_mandate_id,
    amountCents: input.amount_cents,
    description: input.description.slice(0, 100),
  });

  // Crea wallet_entry pendiente (se validará al recibir webhook payment.confirmed)
  const { data: walletEntry } = await admin
    .from("wallet_entries")
    .insert({
      company_id: mandate.company_id,
      customer_id: mandate.customer_id,
      contract_id: input.contract_id ?? null,
      contract_payment_id: input.contract_payment_id ?? null,
      concept: input.description,
      amount_cents: input.amount_cents,
      method: "direct_debit",
      status: "pending",
      collected_by_user_id: session.user_id,
      collected_at: new Date().toISOString(),
      notes: "GoCardless · pendiente confirmación bancaria",
    })
    .select("id")
    .single();

  const { data: dbPay, error } = await admin
    .from("gocardless_payments")
    .insert({
      company_id: mandate.company_id,
      mandate_id: mandate.id,
      customer_id: mandate.customer_id,
      contract_id: input.contract_id ?? null,
      invoice_id: input.invoice_id ?? null,
      contract_payment_id: input.contract_payment_id ?? null,
      wallet_entry_id: (walletEntry as { id: string } | null)?.id ?? null,
      gocardless_payment_id: payment.id,
      amount_cents: input.amount_cents,
      currency: payment.currency,
      description: input.description,
      status: payment.status,
      charge_date: payment.charge_date,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (input.contract_id) revalidatePath(`/contratos/${input.contract_id}`);
  if (input.invoice_id) revalidatePath(`/facturas/${input.invoice_id}`);
  revalidatePath(`/clientes/${mandate.customer_id}`);
  revalidatePath("/wallet");

  return { payment_db_id: (dbPay as { id: string }).id };
}

export interface MandateOption {
  id: string;
  label: string;
  status: string;
}

export async function listActiveMandatesForCustomer(
  customerId: string,
): Promise<MandateOption[]> {
  const all = await listCustomerMandates(customerId);
  return all
    .filter((m) => ["active", "submitted", "pending_submission"].includes(m.status))
    .map((m) => ({
      id: m.id,
      label: `${m.bank_name ?? "Banco"} · ****${m.iban_last4 ?? "----"}`,
      status: m.status,
    }));
}
