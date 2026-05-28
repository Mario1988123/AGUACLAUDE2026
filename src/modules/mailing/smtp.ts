import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { decryptSecret } from "./encryption";
import { isResendConfigured, sendEmailViaResend } from "./resend";

/**
 * Servicio SMTP genérico. Sustituye al cliente Resend.
 *
 * Cascada de configuración:
 *   - automated=true  → company.smtp_automated_*  → (fallback) smtp_company_*  → null
 *   - automated=false → user.smtp_*               → (fallback) smtp_company_*  → null
 *
 * Si solo el admin configura smtp_company_* y deja los usuarios y los
 * automáticos en blanco, TODOS los envíos salen desde esa única cuenta.
 *
 * Las contraseñas SMTP se guardan cifradas (AES-256-GCM) en columnas
 * *_password_enc. Esta capa las descifra justo antes del envío.
 */

export type SendType = "manual" | "automated" | "campaign";

export type TriggerEvent =
  | "maintenance_reminder"
  | "appointment_reminder"
  | "appointment_confirmation"
  | "appointment_cancelled"
  | "contract_sent"
  | "contract_signed"
  | "payment_reminder"
  | "invoice_sent"
  | "client_welcome"
  | "lead_assigned"
  | "proposal_sent"
  | "password_reset"
  | "test_send"
  | "manual_send"
  | "campaign_send"
  | "incident_notification"
  | "gmaps_budget_alert";

export type AccountType =
  | "user"
  | "company_manual"
  | "company_automated"
  | "resend";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** ya descifrada */
  password: string;
  fromEmail: string;
  fromName: string;
  accountType: AccountType;
}

export interface PickConfigOptions {
  companyId: string;
  userId?: string | null;
  automated: boolean;
}

export interface SendEmailParams {
  companyId: string;
  /** Usuario que dispara el envío (NULL para envíos del cron/sistema). */
  senderUserId?: string | null;
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  /** Marca de tipo de envío para el módulo MAIL. */
  sendType: SendType;
  triggerEvent: TriggerEvent;
  /** Entidad relacionada (lead/customer/contract/...) para el scoping. */
  relatedType?: string;
  relatedId?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer | string }>;
}

export interface SendResult {
  ok: true;
  outboxId: string;
  accountType: AccountType;
  /** Id devuelto por Resend (solo cuando accountType==="resend"). Necesario
   *  para que el webhook /api/webhooks/resend enlace el tracking. */
  resend_id?: string | null;
}

export interface SendError {
  ok: false;
  outboxId?: string;
  error: string;
}

// ============================================================================
// 1. Pick SMTP config
// ============================================================================

export async function pickSmtpConfig(opts: PickConfigOptions): Promise<SmtpConfig | null> {
  const admin = createAdminClient();

  // Manual: primero intentamos el SMTP del usuario
  if (!opts.automated && opts.userId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: userRow } = await (admin as any)
      .from("email_user_settings")
      .select(
        "smtp_host, smtp_port, smtp_user, smtp_password_enc, smtp_secure, from_email, from_name",
      )
      .eq("user_id", opts.userId)
      .eq("company_id", opts.companyId)
      .maybeSingle();

    if (userRow?.smtp_host && userRow?.smtp_user && userRow?.smtp_password_enc) {
      return {
        host: userRow.smtp_host,
        port: userRow.smtp_port || 587,
        secure: userRow.smtp_secure ?? true,
        user: userRow.smtp_user,
        password: decryptSecret(userRow.smtp_password_enc),
        fromEmail: userRow.from_email || userRow.smtp_user,
        fromName: userRow.from_name || userRow.smtp_user,
        accountType: "user",
      };
    }
  }

  // Cargamos los dos sets de campos de companies de golpe
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: company } = await (admin as any)
    .from("companies")
    .select(
      `name,
       smtp_company_host, smtp_company_port, smtp_company_user, smtp_company_password_enc,
       smtp_company_from_email, smtp_company_from_name, smtp_company_secure,
       smtp_automated_host, smtp_automated_port, smtp_automated_user, smtp_automated_password_enc,
       smtp_automated_from_email, smtp_automated_from_name, smtp_automated_secure`,
    )
    .eq("id", opts.companyId)
    .maybeSingle();

  if (!company) return null;

  if (opts.automated) {
    if (
      company.smtp_automated_host &&
      company.smtp_automated_user &&
      company.smtp_automated_password_enc
    ) {
      return {
        host: company.smtp_automated_host,
        port: company.smtp_automated_port || 587,
        secure: company.smtp_automated_secure ?? true,
        user: company.smtp_automated_user,
        password: decryptSecret(company.smtp_automated_password_enc),
        fromEmail: company.smtp_automated_from_email || company.smtp_automated_user,
        fromName: company.smtp_automated_from_name || company.name || "Sistema",
        accountType: "company_automated",
      };
    }
    // Fallback: si no hay automated, usa el SMTP de la empresa
  }

  if (
    company.smtp_company_host &&
    company.smtp_company_user &&
    company.smtp_company_password_enc
  ) {
    return {
      host: company.smtp_company_host,
      port: company.smtp_company_port || 587,
      secure: company.smtp_company_secure ?? true,
      user: company.smtp_company_user,
      password: decryptSecret(company.smtp_company_password_enc),
      fromEmail: company.smtp_company_from_email || company.smtp_company_user,
      fromName: company.smtp_company_from_name || company.name || "Sistema",
      accountType: "company_manual",
    };
  }

  return null;
}

// ============================================================================
// 1b. Proveedor de email por empresa (smtp | resend)
// ============================================================================

interface ResendCompanyConfig {
  /** El proveedor de la empresa es 'resend' Y RESEND_API_KEY está configurada
   *  Y el dominio está verificado. Solo entonces se enruta por Resend. */
  ready: boolean;
  fromEmail: string;
  fromName: string;
}

/**
 * Resuelve si los emails de la empresa deben salir por Resend. Lee
 * `companies.email_provider` + el estado de dominio en
 * `company_settings.extra->email_resend`. Fail-soft: ante cualquier duda,
 * `ready=false` → se usa la cascada SMTP normal.
 */
async function loadResendCompanyConfig(companyId: string): Promise<ResendCompanyConfig> {
  const notReady: ResendCompanyConfig = { ready: false, fromEmail: "", fromName: "" };
  if (!isResendConfigured()) return notReady;
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: company } = await (admin as any)
      .from("companies")
      .select("name, email_provider, smtp_company_from_email, smtp_company_from_name")
      .eq("id", companyId)
      .maybeSingle();
    if (!company || company.email_provider !== "resend") return notReady;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: settings } = await (admin as any)
      .from("company_settings")
      .select("extra")
      .eq("company_id", companyId)
      .maybeSingle();
    const resendCfg =
      (settings?.extra as { email_resend?: { status?: string; domain?: string; from_email?: string } } | null)
        ?.email_resend ?? null;
    if (!resendCfg || resendCfg.status !== "verified") return notReady;

    const fromEmail =
      resendCfg.from_email ||
      company.smtp_company_from_email ||
      (resendCfg.domain ? `noreply@${resendCfg.domain}` : "");
    if (!fromEmail) return notReady;

    return {
      ready: true,
      fromEmail,
      fromName: company.smtp_company_from_name || company.name || "Sistema",
    };
  } catch {
    return notReady;
  }
}

// ============================================================================
// 2. Test connection (no guarda nada, no envía nada)
// ============================================================================

export interface TestConnectionInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export async function testSmtpConnection(
  cfg: TestConnectionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const transporter = buildTransporter(cfg);
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de conexión";
    return { ok: false, error: msg };
  }
}

function buildTransporter(cfg: TestConnectionInput): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // Algunos proveedores (Outlook 365) fallan con TLS estricto
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
}

// ============================================================================
// 3. Send email — registra en email_outbox y envía
// ============================================================================

export async function sendViaSmtp(params: SendEmailParams): Promise<SendResult | SendError> {
  const admin = createAdminClient();

  // 1) Registrar el intento en email_outbox (siempre, incluso si fallará por falta de config).
  //    Así el admin lo ve en el módulo MAIL como "failed" con error claro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: outboxRow, error: insertError } = await (admin as any)
    .from("email_outbox")
    .insert({
      company_id: params.companyId,
      to_email: params.to,
      to_name: params.toName ?? null,
      subject: params.subject,
      body_html: params.html,
      body_text: params.text ?? null,
      kind: params.triggerEvent,
      send_type: params.sendType,
      trigger_event: params.triggerEvent,
      sender_user_id: params.senderUserId ?? null,
      related_type: params.relatedType ?? null,
      related_id: params.relatedId ?? null,
      send_at: new Date().toISOString(),
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !outboxRow) {
    return {
      ok: false,
      error: `No se pudo registrar el email en outbox: ${insertError?.message ?? "desconocido"}`,
    };
  }

  const outboxId = outboxRow.id as string;

  // 1b) Dispatch a Resend si la empresa lo tiene activado y listo. Si no está
  //     listo (provider!=resend, sin API key o dominio sin verificar) caemos a
  //     la cascada SMTP de abajo (degradación suave).
  const resendCfg = await loadResendCompanyConfig(params.companyId);
  if (resendCfg.ready) {
    const r = await sendEmailViaResend({
      from_email: resendCfg.fromEmail,
      from_name: resendCfg.fromName,
      reply_to: params.replyTo,
      to_email: params.to,
      to_name: params.toName,
      subject: params.subject,
      body_html: params.html,
      body_text: params.text,
      attachments: params.attachments,
    });
    if (r.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("email_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          from_account_type: "resend",
          from_email: resendCfg.fromEmail,
          from_name: resendCfg.fromName,
        })
        .eq("id", outboxId);
      return { ok: true, outboxId, accountType: "resend", resend_id: r.resend_id };
    }
    // Resend falló: marcamos el fallo y NO caemos a SMTP (la empresa eligió
    // Resend explícitamente; un fallo real debe verse, no enmascararse).
    const rErr = r.error_message ?? "Error de Resend";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("email_outbox")
      .update({ status: "failed", error: rErr, from_account_type: "resend", from_email: resendCfg.fromEmail })
      .eq("id", outboxId);
    return { ok: false, outboxId, error: rErr };
  }

  // 2) Elegir SMTP
  const automated = params.sendType !== "manual";
  const config = await pickSmtpConfig({
    companyId: params.companyId,
    userId: params.senderUserId,
    automated,
  });

  if (!config) {
    const msg = automated
      ? "El admin no ha configurado el SMTP del sistema en /configuracion/mailing."
      : "Configura tu SMTP personal o el de la empresa en /configuracion/mailing.";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("email_outbox")
      .update({ status: "failed", error: msg })
      .eq("id", outboxId);
    return { ok: false, outboxId, error: msg };
  }

  // 3) Enviar
  try {
    const transporter = buildTransporter({
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      password: config.password,
    });

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: params.toName ? `"${params.toName}" <${params.to}>` : params.to,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("email_outbox")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        from_account_type: config.accountType,
        from_email: config.fromEmail,
        from_name: config.fromName,
      })
      .eq("id", outboxId);

    return { ok: true, outboxId, accountType: config.accountType };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Error desconocido al enviar";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("email_outbox")
      .update({
        status: "failed",
        error: errorMsg,
        from_account_type: config.accountType,
        from_email: config.fromEmail,
        from_name: config.fromName,
      })
      .eq("id", outboxId);
    return { ok: false, outboxId, error: errorMsg };
  }
}

// ============================================================================
// 4. Helper: ¿hay alguna config SMTP en la empresa?
// ============================================================================

export async function hasAnySmtpConfigured(companyId: string): Promise<boolean> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("companies")
    .select("smtp_company_host, smtp_automated_host")
    .eq("id", companyId)
    .maybeSingle();
  return Boolean(data?.smtp_company_host || data?.smtp_automated_host);
}
