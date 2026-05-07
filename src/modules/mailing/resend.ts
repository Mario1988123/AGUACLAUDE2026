/**
 * Cliente Resend — capa de abstracción sobre el SDK oficial.
 * Toda interacción con Resend pasa por aquí (envíos, dominios, webhooks).
 */

import { Resend } from "resend";

let _client: Resend | null = null;

export function getResend(): Resend {
  if (_client) return _client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY no configurada. Genera una key en https://resend.com/api-keys y añádela a Vercel.",
    );
  }
  _client = new Resend(apiKey);
  return _client;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface SendEmailInput {
  from_email: string;
  from_name?: string;
  reply_to?: string;
  to_email: string;
  to_name?: string;
  subject: string;
  body_html: string;
  body_text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string; // base64 string o buffer
  }>;
  /** Cabecera List-Unsubscribe RFC 8058. Para emails marketing. */
  list_unsubscribe_url?: string;
  metadata?: Record<string, string>;
}

export interface SendEmailResult {
  ok: boolean;
  resend_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

/**
 * Envía un email via API REST de Resend.
 */
export async function sendEmailViaResend(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!isResendConfigured()) {
    return {
      ok: false,
      resend_id: null,
      error_code: "NOT_CONFIGURED",
      error_message: "RESEND_API_KEY no configurada en el servidor",
    };
  }

  try {
    const resend = getResend();
    const fromHeader = input.from_name
      ? `${input.from_name} <${input.from_email}>`
      : input.from_email;
    const toHeader = input.to_name
      ? `${input.to_name} <${input.to_email}>`
      : input.to_email;

    const headers: Record<string, string> = {};
    if (input.list_unsubscribe_url) {
      // RFC 8058 — un click para desuscribirse
      headers["List-Unsubscribe"] = `<${input.list_unsubscribe_url}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      from: fromHeader,
      to: toHeader,
      subject: input.subject,
      html: input.body_html,
      text: input.body_text,
      reply_to: input.reply_to,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      attachments: input.attachments,
      tags: input.metadata
        ? Object.entries(input.metadata).map(([name, value]) => ({
            name,
            value: String(value).slice(0, 256),
          }))
        : undefined,
    };

    const result = await resend.emails.send(params);
    if (result.error) {
      return {
        ok: false,
        resend_id: null,
        error_code: result.error.name ?? "RESEND_ERROR",
        error_message: result.error.message ?? "Error de Resend",
      };
    }

    return {
      ok: true,
      resend_id: result.data?.id ?? null,
      error_code: null,
      error_message: null,
    };
  } catch (e) {
    console.error("[resend] send failed:", e);
    return {
      ok: false,
      resend_id: null,
      error_code: "EXCEPTION",
      error_message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Crear/verificar dominio en Resend. Devuelve los DNS records que el
 * admin tiene que pegar en su proveedor DNS.
 */
export async function createOrFetchDomain(domain: string): Promise<{
  resend_domain_id: string | null;
  status: string;
  records: Array<{ type: string; name: string; value: string; status: string }>;
  error: string | null;
}> {
  if (!isResendConfigured()) {
    return {
      resend_domain_id: null,
      status: "not_configured",
      records: [],
      error: "RESEND_API_KEY no configurada",
    };
  }

  try {
    const resend = getResend();
    const created = await resend.domains.create({ name: domain });
    if (created.error) {
      // Si ya existe, intentar listar y encontrar
      const list = await resend.domains.list();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (list.data as any)?.data?.find?.(
        (d: { name: string }) => d.name === domain,
      );
      if (existing) {
        const detail = await resend.domains.get(existing.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = detail.data as any;
        return {
          resend_domain_id: existing.id,
          status: d?.status ?? "pending",
          records:
            d?.records?.map(
              (r: { record: string; name: string; value: string; status: string }) => ({
                type: r.record,
                name: r.name,
                value: r.value,
                status: r.status,
              }),
            ) ?? [],
          error: null,
        };
      }
      return {
        resend_domain_id: null,
        status: "failed",
        records: [],
        error: created.error.message,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = created.data as any;
    return {
      resend_domain_id: data?.id ?? null,
      status: data?.status ?? "pending",
      records:
        data?.records?.map(
          (r: { record: string; name: string; value: string; status: string }) => ({
            type: r.record,
            name: r.name,
            value: r.value,
            status: r.status,
          }),
        ) ?? [],
      error: null,
    };
  } catch (e) {
    return {
      resend_domain_id: null,
      status: "error",
      records: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Pide a Resend que verifique los DNS del dominio (DKIM/SPF/DMARC).
 */
export async function verifyDomain(resendDomainId: string): Promise<{
  status: string;
  error: string | null;
}> {
  if (!isResendConfigured()) {
    return { status: "not_configured", error: "RESEND_API_KEY no configurada" };
  }
  try {
    const resend = getResend();
    const r = await resend.domains.verify(resendDomainId);
    if (r.error) {
      return { status: "failed", error: r.error.message };
    }
    const detail = await resend.domains.get(resendDomainId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = detail.data as any;
    return { status: d?.status ?? "pending", error: null };
  } catch (e) {
    return {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
