/**
 * Cliente HTTP minimalista para GoCardless API.
 *
 * Docs: https://developer.gocardless.com/api-reference/
 *
 * Decisión: en lugar de usar el SDK oficial (peso adicional, capa de
 * abstracción que añade poco) llamamos al API REST directamente con fetch.
 * Headers obligatorios:
 *   Authorization: Bearer <access_token>
 *   GoCardless-Version: 2015-07-06 (estable)
 *   Accept: application/json
 *   Idempotency-Key: <uuid>  (en POST que crean recursos)
 *
 * Ambientes:
 *   sandbox → https://api-sandbox.gocardless.com
 *   live    → https://api.gocardless.com
 */

import crypto from "node:crypto";

export type Environment = "sandbox" | "live";

const BASE_URL: Record<Environment, string> = {
  sandbox: "https://api-sandbox.gocardless.com",
  live: "https://api.gocardless.com",
};

const API_VERSION = "2015-07-06";

export interface GoCardlessConfig {
  accessToken: string;
  environment: Environment;
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
}

export class GoCardlessError extends Error {
  status: number;
  errors: unknown;
  constructor(message: string, status: number, errors: unknown) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(config: GoCardlessConfig, opts: RequestOptions): Promise<T> {
  const url = `${BASE_URL[config.environment]}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    "GoCardless-Version": API_VERSION,
    Accept: "application/json",
  };
  if (opts.body) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.idempotencyKey && opts.method === "POST") {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  const res = await fetch(url, {
    method: opts.method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }
  if (!res.ok) {
    const errPayload = (data as { error?: { message?: string; errors?: unknown } })?.error;
    throw new GoCardlessError(
      errPayload?.message ?? `GoCardless ${res.status}`,
      res.status,
      errPayload?.errors ?? data,
    );
  }
  return data as T;
}

// ============================================================================
// Tipos parciales (sólo campos que usamos)
// ============================================================================

export interface GcRedirectFlow {
  id: string;
  redirect_url: string;
  session_token: string;
  links: {
    mandate?: string;
    customer?: string;
    customer_bank_account?: string;
  };
}

export interface GcMandate {
  id: string;
  status: string;
  scheme: string;
  reference: string | null;
  links: {
    customer: string;
    customer_bank_account: string;
  };
  created_at: string;
}

export interface GcCustomerBankAccount {
  id: string;
  account_holder_name: string;
  account_number_ending: string;
  bank_name: string | null;
  country_code: string | null;
}

export interface GcPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  charge_date: string | null;
  description: string | null;
  links: { mandate: string };
}

// ============================================================================
// Recursos
// ============================================================================

/** Crea un redirect flow para que el cliente firme un mandato online. */
export async function createRedirectFlow(
  config: GoCardlessConfig,
  input: {
    description: string;
    sessionToken: string;
    successRedirectUrl: string;
    customer?: {
      given_name?: string;
      family_name?: string;
      email?: string;
      company_name?: string;
      address_line1?: string;
      city?: string;
      postal_code?: string;
      country_code?: string;  // "ES"
    };
  },
): Promise<GcRedirectFlow> {
  const res = await request<{ redirect_flows: GcRedirectFlow }>(config, {
    method: "POST",
    path: "/redirect_flows",
    idempotencyKey: crypto.randomUUID(),
    body: {
      redirect_flows: {
        description: input.description,
        session_token: input.sessionToken,
        success_redirect_url: input.successRedirectUrl,
        ...(input.customer ? { prefilled_customer: input.customer } : {}),
      },
    },
  });
  return res.redirect_flows;
}

/** Tras volver del redirect, completar el flow para crear mandato real. */
export async function completeRedirectFlow(
  config: GoCardlessConfig,
  redirectFlowId: string,
  sessionToken: string,
): Promise<GcRedirectFlow> {
  const res = await request<{ redirect_flows: GcRedirectFlow }>(config, {
    method: "POST",
    path: `/redirect_flows/${redirectFlowId}/actions/complete`,
    body: { data: { session_token: sessionToken } },
  });
  return res.redirect_flows;
}

export async function getMandate(config: GoCardlessConfig, mandateId: string): Promise<GcMandate> {
  const res = await request<{ mandates: GcMandate }>(config, {
    method: "GET",
    path: `/mandates/${mandateId}`,
  });
  return res.mandates;
}

export async function cancelMandate(
  config: GoCardlessConfig,
  mandateId: string,
): Promise<GcMandate> {
  const res = await request<{ mandates: GcMandate }>(config, {
    method: "POST",
    path: `/mandates/${mandateId}/actions/cancel`,
    body: {},
  });
  return res.mandates;
}

export async function getBankAccount(
  config: GoCardlessConfig,
  bankAccountId: string,
): Promise<GcCustomerBankAccount> {
  const res = await request<{ customer_bank_accounts: GcCustomerBankAccount }>(config, {
    method: "GET",
    path: `/customer_bank_accounts/${bankAccountId}`,
  });
  return res.customer_bank_accounts;
}

/** Crea un pago contra un mandato activo. */
export async function createPayment(
  config: GoCardlessConfig,
  input: {
    mandateId: string;
    amountCents: number;
    currency?: string;
    description?: string;
    chargeDate?: string;  // YYYY-MM-DD
    metadata?: Record<string, string>;
  },
): Promise<GcPayment> {
  const res = await request<{ payments: GcPayment }>(config, {
    method: "POST",
    path: "/payments",
    idempotencyKey: crypto.randomUUID(),
    body: {
      payments: {
        amount: input.amountCents,
        currency: input.currency ?? "EUR",
        ...(input.chargeDate ? { charge_date: input.chargeDate } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        links: { mandate: input.mandateId },
      },
    },
  });
  return res.payments;
}

export async function getPayment(
  config: GoCardlessConfig,
  paymentId: string,
): Promise<GcPayment> {
  const res = await request<{ payments: GcPayment }>(config, {
    method: "GET",
    path: `/payments/${paymentId}`,
  });
  return res.payments;
}

/** Verifica firma HMAC SHA256 de un webhook. */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): boolean {
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  // timing-safe compare
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
