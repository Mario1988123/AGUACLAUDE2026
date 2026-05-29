"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import {
  renderTemplate,
  buildEmailHtml,
  buildSignatureHtml,
} from "./templates";
import { loadCompanyEmailContext } from "./company-context";
import { getSampleVars } from "./sample-vars";
import { getSystemTemplates } from "./system-templates";
import {
  pickSmtpConfig,
  testSmtpConnection,
  sendViaSmtp,
  type TriggerEvent,
} from "./smtp";
import { encryptSecret } from "./encryption";
import { createOrFetchDomain, verifyDomain } from "./resend";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede gestionar mailing");
  }
  return session;
}

// =====================================================================
// SMTP DE LA EMPRESA — dos cuentas (manual + automated)
//
// El admin configura DOS cuentas SMTP para su empresa:
//   - manual: el "email del admin como persona" para envíos manuales
//             y como fallback para usuarios sin SMTP propio.
//   - automated: el email genérico del sistema (noreply@empresa.com)
//                para mensajes automáticos (recordatorios, contratos…).
//
// Las contraseñas se guardan CIFRADAS (AES-256-GCM).
// =====================================================================

export type SmtpScope = "company_manual" | "company_automated";

export interface SmtpFormInput {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  /** Si vacío/undefined, se mantiene la contraseña ya guardada. */
  smtp_password?: string;
  smtp_secure: boolean;
  smtp_from_email: string;
  smtp_from_name?: string;
  smtp_provider?: string;
}

export interface SmtpConfigSummary {
  configured: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_secure: boolean;
  smtp_from_email: string;
  smtp_from_name: string;
  smtp_provider: string | null;
  smtp_updated_at: string | null;
}

const EMPTY_SMTP: SmtpConfigSummary = {
  configured: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_secure: true,
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_provider: null,
  smtp_updated_at: null,
};

function colPrefix(scope: SmtpScope): string {
  return scope === "company_manual" ? "smtp_company" : "smtp_automated";
}

export async function getCompanySmtpAction(scope: SmtpScope): Promise<SmtpConfigSummary> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const p = colPrefix(scope);
  const { data } = await admin
    .from("companies")
    .select(
      [
        `${p}_host`,
        `${p}_port`,
        `${p}_user`,
        `${p}_password_enc`,
        `${p}_secure`,
        `${p}_from_email`,
        `${p}_from_name`,
        `${p}_provider`,
        `${p}_updated_at`,
      ].join(","),
    )
    .eq("id", session.company_id)
    .maybeSingle();

  if (!data) return EMPTY_SMTP;
  return {
    configured: Boolean(data[`${p}_host`] && data[`${p}_password_enc`]),
    smtp_host: data[`${p}_host`] ?? "",
    smtp_port: data[`${p}_port`] ?? 587,
    smtp_user: data[`${p}_user`] ?? "",
    smtp_secure: data[`${p}_secure`] ?? true,
    smtp_from_email: data[`${p}_from_email`] ?? "",
    smtp_from_name: data[`${p}_from_name`] ?? "",
    smtp_provider: data[`${p}_provider`] ?? null,
    smtp_updated_at: data[`${p}_updated_at`] ?? null,
  };
}

export async function setCompanySmtpAction(
  scope: SmtpScope,
  input: SmtpFormInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!input.smtp_host || !input.smtp_user || !input.smtp_from_email) {
      return { ok: false, error: "Faltan servidor, usuario o email remitente." };
    }
    const p = colPrefix(scope);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const update: Record<string, unknown> = {
      [`${p}_host`]: input.smtp_host,
      [`${p}_port`]: input.smtp_port || 587,
      [`${p}_user`]: input.smtp_user,
      [`${p}_secure`]: input.smtp_secure,
      [`${p}_from_email`]: input.smtp_from_email,
      [`${p}_from_name`]: input.smtp_from_name ?? null,
      [`${p}_provider`]: input.smtp_provider ?? null,
      [`${p}_updated_at`]: new Date().toISOString(),
    };

    if (input.smtp_password && input.smtp_password !== "********") {
      update[`${p}_password_enc`] = encryptSecret(input.smtp_password);
    }

    const { error } = await admin
      .from("companies")
      .update(update)
      .eq("id", session.company_id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/configuracion/mailing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// (setUserSmtpAction vive en user-smtp-actions.ts — más limpio para evitar
//  acoplar lógica de admin-de-usuario con lógica de empresa.)

// =====================================================================
// TEST SMTP — probar conexión sin guardar nada
// =====================================================================

export interface TestSmtpInput {
  scope: SmtpScope | "user";
  /** Si no hay smtp_password, se descifra la guardada en BD. */
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password?: string;
  smtp_secure: boolean;
  /** Para scope='user', el id del usuario cuya contraseña descifrar. */
  user_id?: string;
}

export async function testSmtpAction(
  input: TestSmtpInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };

    let password = input.smtp_password ?? "";
    if (!password || password === "********") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      if (input.scope === "user") {
        const uid = input.user_id ?? session.user_id;
        if (!session.roles.includes("company_admin") && uid !== session.user_id) {
          return { ok: false, error: "No autorizado" };
        }
        const { data } = await admin
          .from("email_user_settings")
          .select("smtp_password_enc")
          .eq("user_id", uid)
          .maybeSingle();
        if (data?.smtp_password_enc) {
          const { decryptSecret } = await import("./encryption");
          password = decryptSecret(data.smtp_password_enc);
        }
      } else {
        if (!session.roles.includes("company_admin")) {
          return { ok: false, error: "Solo admin puede probar SMTP de empresa" };
        }
        const p = colPrefix(input.scope);
        const { data } = await admin
          .from("companies")
          .select(`${p}_password_enc`)
          .eq("id", session.company_id)
          .maybeSingle();
        const enc = data?.[`${p}_password_enc`];
        if (enc) {
          const { decryptSecret } = await import("./encryption");
          password = decryptSecret(enc);
        }
      }
    }

    if (!password) {
      return { ok: false, error: "Falta la contraseña. Introdúcela para probar la conexión." };
    }

    return await testSmtpConnection({
      host: input.smtp_host,
      port: input.smtp_port || 587,
      secure: input.smtp_secure,
      user: input.smtp_user,
      password,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =====================================================================
// CONFIG USUARIO — su email empresa + firma
// (los campos SMTP por usuario los gestionan setUserSmtpAction / get más abajo)
// =====================================================================

export async function getMyEmailSettings(): Promise<{
  from_email: string | null;
  from_name: string | null;
  signature_html: string | null;
  smtp_configured: boolean;
} | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: my } = await admin
    .from("email_user_settings")
    .select("from_email, from_name, signature_html, smtp_host, smtp_password_enc")
    .eq("user_id", session.user_id)
    .maybeSingle();
  return {
    from_email: my?.from_email ?? null,
    from_name: my?.from_name ?? null,
    signature_html: my?.signature_html ?? null,
    smtp_configured: Boolean(my?.smtp_host && my?.smtp_password_enc),
  };
}

export async function setMyEmailSettingsAction(input: {
  from_email: string;
  from_name?: string;
  signature_html?: string;
}): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const email = input.from_email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email inválido");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const payload = {
    user_id: session.user_id,
    company_id: session.company_id,
    from_email: email,
    from_name: input.from_name?.trim() || null,
    signature_html: input.signature_html?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("email_user_settings")
    .select("user_id")
    .eq("user_id", session.user_id)
    .maybeSingle();

  if (existing) {
    await admin.from("email_user_settings").update(payload).eq("user_id", session.user_id);
  } else {
    await admin.from("email_user_settings").insert(payload);
  }
}

// =====================================================================
// PLANTILLAS — siembra de las pre-creadas + lista
// =====================================================================

export async function ensureSystemTemplatesSeeded(): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { count } = await admin
    .from("email_templates")
    .select("id", { count: "exact", head: true })
    .eq("company_id", session.company_id)
    .eq("is_system", true);

  if ((count ?? 0) > 0) return; // ya sembradas

  const seeds = getSystemTemplates().map((t) => ({
    company_id: session.company_id,
    key: t.key,
    name: t.name,
    description: t.description,
    kind: t.kind,
    subject: t.subject,
    body_html: t.body_html,
    body_text: null,
    variables: t.variables,
    is_system: true,
    is_active: true,
  }));

  await admin.from("email_templates").insert(seeds);
}

export interface TemplateRow {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  kind: "transactional" | "marketing";
  subject: string;
  is_system: boolean;
  is_active: boolean;
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const session = await ensureAdmin();
  await ensureSystemTemplatesSeeded();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("email_templates")
    .select("id, key, name, description, kind, subject, is_system, is_active")
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .order("is_system", { ascending: false })
    .order("kind")
    .order("name");
  return (data ?? []) as TemplateRow[];
}

// =====================================================================
// EDITOR DE PLANTILLAS — ver, editar, restaurar, previsualizar
// La empresa personaliza el asunto/cuerpo de cualquier plantilla. Las de
// sistema (is_system) se pueden restaurar al original del catálogo.
// =====================================================================

export interface TemplateEditData {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  kind: "transactional" | "marketing";
  subject: string;
  body_html: string;
  variables: string[];
  is_system: boolean;
  is_active: boolean;
}

export async function getTemplateForEditAction(
  id: string,
): Promise<TemplateEditData | null> {
  const session = await ensureAdmin();
  await ensureSystemTemplatesSeeded();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("email_templates")
    .select(
      "id, key, name, description, kind, subject, body_html, variables, is_system, is_active",
    )
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!data) return null;
  return {
    ...(data as TemplateEditData),
    variables: (data as { variables: string[] | null }).variables ?? [],
  };
}

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().trim().min(1, "El asunto no puede estar vacío"),
  body_html: z.string().trim().min(1, "El cuerpo no puede estar vacío"),
  is_active: z.boolean().nullish(),
});

export async function updateTemplateAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(updateTemplateSchema, input, "Plantilla");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const update: Record<string, unknown> = {
      subject: parsed.subject,
      body_html: parsed.body_html,
      updated_at: new Date().toISOString(),
    };
    if (parsed.is_active !== undefined && parsed.is_active !== null) {
      update.is_active = parsed.is_active;
    }
    const { error } = await admin
      .from("email_templates")
      .update(update)
      .eq("id", parsed.id)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/mailing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function resetTemplateToSystemAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: row } = await admin
      .from("email_templates")
      .select("key")
      .eq("id", id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    const key = (row as { key: string | null } | null)?.key;
    if (!key) {
      return {
        ok: false,
        error: "Esta plantilla no tiene equivalente de sistema para restaurar.",
      };
    }
    const { getSystemTemplateByKey } = await import("./system-templates");
    const sys = getSystemTemplateByKey(key);
    if (!sys) {
      return { ok: false, error: "No existe plantilla de sistema con esa clave." };
    }
    const { error } = await admin
      .from("email_templates")
      .update({
        subject: sys.subject,
        body_html: sys.body_html,
        variables: sys.variables,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", session.company_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/configuracion/mailing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Renderiza una plantilla (en edición, sin guardar) con datos de muestra y el
 * branding real de la empresa. Devuelve el HTML completo para el iframe de
 * previsualización del editor.
 */
export async function previewTemplateHtmlAction(input: {
  subject: string;
  body_html: string;
  kind: "transactional" | "marketing";
}): Promise<{ subject: string; html: string }> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const ctx = session.company_id
    ? await loadCompanyEmailContext(session.company_id, admin).catch(() => null)
    : null;
  const company = ctx?.company ?? {
    legal_name: "Tu empresa",
    tax_id: "—",
    address: null,
    email: null,
    phone: null,
  };
  const branding = ctx?.branding ?? null;
  const vars = getSampleVars({ company_name: company.legal_name });
  const subject = renderTemplate(input.subject ?? "", vars);
  const body = renderTemplate(input.body_html ?? "", vars);
  const html = buildEmailHtml({
    body_html: body,
    company,
    branding,
    kind: input.kind,
    unsubscribe_url:
      input.kind === "marketing"
        ? "https://example.com/baja?token=preview"
        : undefined,
  });
  return { subject, html };
}

// =====================================================================
// ENVIAR EMAIL (transaccional o marketing) — núcleo
// =====================================================================

export interface SendTransactionalInput {
  template_key: string;
  to_email: string;
  to_name?: string;
  customer_id?: string | null;
  lead_id?: string | null;
  variables?: Record<string, unknown>;
  attachments?: Array<{ filename: string; content_base64: string }>;
  related_subject_type?: string;
  related_subject_id?: string;
}

/**
 * Envía un email transaccional. Sin opt-out (es operativo).
 * Renderiza la plantilla, le añade firma del usuario actual (si la tiene)
 * y footer legal, y lo manda vía SMTP usando la cuenta configurada en
 * /configuracion/mailing (cascade: SMTP usuario → SMTP empresa).
 */
export async function sendTransactionalEmail(
  input: SendTransactionalInput,
): Promise<{ ok: boolean; send_id?: string; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Plantilla: primero BD (personalizadas por empresa). Si no, fallback al
  // catálogo del sistema (system-templates.ts) — así nunca falla por no
  // haber seedeado las plantillas iniciales.
  const { data: tplRow } = await admin
    .from("email_templates")
    .select("id, subject, body_html, kind")
    .eq("company_id", session.company_id)
    .eq("key", input.template_key)
    .eq("is_active", true)
    .maybeSingle();
  let tpl: { id: string | null; subject: string; body_html: string; kind: "transactional" | "marketing" } | null =
    (tplRow as { id: string; subject: string; body_html: string; kind: "transactional" | "marketing" } | null) ?? null;
  if (!tpl) {
    const { getSystemTemplateByKey } = await import("./system-templates");
    const sys = getSystemTemplateByKey(input.template_key);
    if (sys) {
      tpl = {
        id: null,
        subject: sys.subject,
        body_html: sys.body_html,
        kind: sys.kind,
      };
    }
  }
  if (!tpl) {
    return {
      ok: false,
      error: `Plantilla "${input.template_key}" no encontrada. Ve a /configuracion/mailing y cárgala desde el catálogo del sistema.`,
    };
  }

  // RGPD — dos niveles de bloqueo:
  //   1. data_processing EXPLÍCITAMENTE revocado → bloqueo absoluto
  //      (no se le puede enviar NADA, ni siquiera transaccional).
  //   2. plantilla 'marketing' + commercial no concedido → bloqueo solo
  //      del envío comercial.
  if (input.customer_id) {
    const { data: dpRow } = await admin
      .from("customer_consents")
      .select("granted")
      .eq("customer_id", input.customer_id)
      .eq("kind", "data_processing")
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dpRevoked =
      dpRow && (dpRow as { granted: boolean }).granted === false;
    if (dpRevoked) {
      return {
        ok: false,
        error:
          "El cliente revocó el tratamiento de datos (RGPD). No se le pueden enviar comunicaciones.",
      };
    }
    if ((tpl as { kind: string }).kind === "marketing") {
      const { hasActiveConsent } = await import("@/modules/customers/consents-actions");
      const allowed = await hasActiveConsent(input.customer_id, "commercial");
      if (!allowed) {
        return {
          ok: false,
          error: "Cliente sin consentimiento para comunicaciones comerciales (RGPD)",
        };
      }
    }
  }

  // Settings del usuario (su email empresa + firma)
  const { data: userSettings } = await admin
    .from("email_user_settings")
    .select("from_email, from_name, signature_html")
    .eq("user_id", session.user_id)
    .maybeSingle();

  // Datos empresa para footer legal + branding (logo/color)
  const ctx = await loadCompanyEmailContext(session.company_id, admin);

  // Elegimos la cuenta SMTP que enviará (cascade user → company_manual → company_automated).
  // El "from" mostrado en el email se calcula a partir de la cuenta elegida, pero si el usuario
  // tiene from_email propio en email_user_settings lo respetamos (más legible para el destinatario).
  // No exigimos SMTP aquí: una empresa puede estar en modo Resend (sin SMTP).
  // sendViaSmtp resuelve el proveedor y devuelve un error claro si no hay
  // ninguno disponible.
  const cfg = await pickSmtpConfig({
    companyId: session.company_id,
    userId: session.user_id,
    automated: false,
  });

  const fromEmail =
    userSettings?.from_email ?? cfg?.fromEmail ?? ctx.company.email ?? "";
  const fromName =
    userSettings?.from_name ?? cfg?.fromName ?? ctx.company.legal_name ?? "AGUACLAUDE";

  // Renderizar
  const baseVars = {
    company_name: ctx.company.legal_name ?? "Nuestra empresa",
    customer_name: input.to_name ?? "",
    customer_first_name: input.to_name?.split(" ")[0] ?? "",
    ...input.variables,
  };
  const subject = renderTemplate(tpl.subject, baseVars);
  const bodyRendered = renderTemplate(tpl.body_html, baseVars);

  // Construir HTML completo (con firma + footer)
  const html = buildEmailHtml({
    body_html: bodyRendered,
    signature_html: userSettings?.signature_html ?? null,
    company: ctx.company,
    branding: ctx.branding,
    kind: tpl.kind,
  });

  // Enviar: delegamos en sendViaSmtp, que enruta por Resend (si la empresa lo
  // tiene activo y con dominio verificado) o por la cascada SMTP, registra el
  // intento en email_outbox y devuelve resend_id para el tracking.
  const sendResult = await sendViaSmtp({
    companyId: session.company_id,
    senderUserId: session.user_id,
    to: input.to_email,
    toName: input.to_name,
    subject,
    html,
    sendType: "manual",
    triggerEvent: "manual_send",
    relatedType:
      input.related_subject_type ??
      (input.customer_id ? "customer" : input.lead_id ? "lead" : undefined),
    relatedId:
      input.related_subject_id ?? input.customer_id ?? input.lead_id ?? undefined,
    replyTo: userSettings?.from_email ?? session.email ?? undefined,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content_base64, "base64"),
    })),
  });
  const sendOk = sendResult.ok;
  const sendError = sendResult.ok ? null : sendResult.error;
  const usedAccountType = sendResult.ok ? sendResult.accountType : cfg?.accountType ?? null;
  const usedResendId = sendResult.ok ? sendResult.resend_id ?? null : null;

  // Persistir el envío
  const { data: sendRow } = await admin
    .from("email_sends")
    .insert({
      company_id: session.company_id,
      user_id: session.user_id,
      template_id: tpl.id,
      template_key: input.template_key,
      to_email: input.to_email,
      to_name: input.to_name,
      customer_id: input.customer_id ?? null,
      lead_id: input.lead_id ?? null,
      from_email: fromEmail,
      from_name: fromName,
      subject,
      body_html: html,
      kind: tpl.kind,
      status: sendOk ? "sent" : "failed",
      error_message: sendError,
      sent_at: sendOk ? new Date().toISOString() : null,
      attachments_meta: input.attachments?.map((a) => ({ name: a.filename })) ?? [],
      related_subject_type: input.related_subject_type ?? null,
      related_subject_id: input.related_subject_id ?? null,
      send_type: "manual",
      trigger_event: "manual_send" as TriggerEvent,
      from_account_type: usedAccountType,
      resend_id: usedResendId,
    })
    .select("id")
    .single();

  const sendId = (sendRow as { id: string } | null)?.id;

  // Insertar evento timeline en events para que aparezca en la ficha
  // del cliente/contrato/propuesta. Fail-soft.
  if (sendId && sendOk) {
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: input.related_subject_type ?? (input.customer_id ? "customer" : "lead"),
        subject_id:
          input.related_subject_id ??
          input.customer_id ??
          input.lead_id ??
          session.company_id,
        kind: "email.sent",
        payload: {
          email_send_id: sendId,
          template_key: input.template_key,
          template_kind: tpl.kind,
          to_email: input.to_email,
          subject,
        },
        actor_user_id: session.user_id,
      });
    } catch (e) {
      console.error("[sendTransactionalEmail] event insert failed:", e);
    }
  }

  return {
    ok: sendOk,
    send_id: sendId,
    error: sendError ?? undefined,
  };
}

// Nota: sendViaSmtp NO se re-exporta aquí (Next 15 "use server" prohíbe
// re-exports de funciones). Importarlo directamente desde "@/modules/mailing/smtp".

// ============================================================================
// Envío rápido AD-HOC desde el CRM (sin plantilla). Sustituye los botones que
// antes abrían mailto: (cliente de correo externo). TODO sale del CRM.
// ============================================================================
function escapeHtmlBasic(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const quickEmailSchema = z.object({
  to_email: z.string().email("Email destinatario inválido"),
  to_name: z.string().nullish(),
  subject: z.string().min(1, "Asunto obligatorio"),
  body: z.string().min(1, "Cuerpo obligatorio"),
  customer_id: z.string().uuid().nullish(),
  lead_id: z.string().uuid().nullish(),
  related_subject_type: z.string().nullish(),
  related_subject_id: z.string().uuid().nullish(),
});

export async function sendQuickEmailAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(quickEmailSchema, input, "Email");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const ctx = await loadCompanyEmailContext(session.company_id, admin);
    const { data: us } = await admin
      .from("email_user_settings")
      .select("signature_html, from_email, from_name")
      .eq("user_id", session.user_id)
      .maybeSingle();

    const bodyHtml = `<p>${escapeHtmlBasic(parsed.body).replace(/\n/g, "<br>")}</p>`;
    const html = buildEmailHtml({
      body_html: bodyHtml,
      signature_html: us?.signature_html ?? null,
      company: ctx.company,
      branding: ctx.branding,
      kind: "transactional",
    });

    const res = await sendViaSmtp({
      companyId: session.company_id,
      senderUserId: session.user_id,
      to: parsed.to_email,
      toName: parsed.to_name ?? undefined,
      subject: parsed.subject,
      html,
      sendType: "manual",
      triggerEvent: "manual_send",
      relatedType: parsed.related_subject_type ?? undefined,
      relatedId: parsed.related_subject_id ?? undefined,
      replyTo: us?.from_email ?? session.email ?? undefined,
    });

    try {
      await admin.from("email_sends").insert({
        company_id: session.company_id,
        user_id: session.user_id,
        to_email: parsed.to_email,
        to_name: parsed.to_name ?? null,
        customer_id: parsed.customer_id ?? null,
        lead_id: parsed.lead_id ?? null,
        from_email: us?.from_email ?? ctx.company.email ?? "",
        from_name: us?.from_name ?? ctx.company.legal_name ?? "",
        subject: parsed.subject,
        body_html: html,
        kind: "transactional",
        status: res.ok ? "sent" : "failed",
        error_message: res.ok ? null : res.error,
        sent_at: res.ok ? new Date().toISOString() : null,
        related_subject_type: parsed.related_subject_type ?? null,
        related_subject_id: parsed.related_subject_id ?? null,
        send_type: "manual",
        trigger_event: "manual_send",
        from_account_type: res.ok ? res.accountType : null,
        resend_id: res.ok ? res.resend_id ?? null : null,
      });
    } catch {
      /* fail-soft del registro */
    }

    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// ============================================================================
// Dominio Resend (solo empresas con email_provider='resend')
// La config vive en company_settings.extra->email_resend.
// ============================================================================

export interface DomainStatus {
  domain: string;
  status: string;
  resend_domain_id: string | null;
  verified_at: string | null;
  failure_reason: string | null;
  records: Array<{ type: string; name: string; value: string; status: string }>;
}

async function readEmailResend(
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<{ extra: Record<string, unknown>; cfg: DomainStatus | null }> {
  const { data } = await admin
    .from("company_settings")
    .select("extra")
    .eq("company_id", companyId)
    .maybeSingle();
  const extra = (data?.extra as Record<string, unknown> | null) ?? {};
  const cfg = (extra.email_resend as DomainStatus | undefined) ?? null;
  return { extra, cfg };
}

async function writeEmailResend(
  companyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  extra: Record<string, unknown>,
  cfg: DomainStatus,
): Promise<void> {
  const newExtra = { ...extra, email_resend: cfg };
  const { data: existing } = await admin
    .from("company_settings")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (existing) {
    await admin.from("company_settings").update({ extra: newExtra }).eq("company_id", companyId);
  } else {
    await admin.from("company_settings").insert({ company_id: companyId, extra: newExtra });
  }
}

/** Loader para la página de configuración (server component). */
export async function getMailingDomainStatus(): Promise<DomainStatus | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { cfg } = await readEmailResend(session.company_id, admin);
  return cfg && cfg.domain ? cfg : null;
}

export async function addMailingDomainSafeAction(
  domain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
      return { ok: false, error: "Dominio inválido. Usa solo el dominio raíz (ej. aguasl.com)." };
    }
    const res = await createOrFetchDomain(clean);
    if (res.error && !res.resend_domain_id) {
      return { ok: false, error: res.error };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { extra } = await readEmailResend(session.company_id, admin);
    await writeEmailResend(session.company_id, admin, extra, {
      domain: clean,
      status: res.status,
      resend_domain_id: res.resend_domain_id,
      verified_at: res.status === "verified" ? new Date().toISOString() : null,
      failure_reason: null,
      records: res.records,
    });
    revalidatePath("/configuracion/mailing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function verifyMailingDomainSafeAction(): Promise<
  { ok: true; status: string } | { ok: false; error: string }
> {
  try {
    const session = await ensureAdmin();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { extra, cfg } = await readEmailResend(session.company_id, admin);
    if (!cfg || !cfg.resend_domain_id) {
      return { ok: false, error: "No hay dominio Resend que verificar. Añádelo primero." };
    }
    const res = await verifyDomain(cfg.resend_domain_id);
    await writeEmailResend(session.company_id, admin, extra, {
      ...cfg,
      status: res.status,
      verified_at: res.status === "verified" ? new Date().toISOString() : cfg.verified_at,
      failure_reason: res.error ?? null,
    });
    revalidatePath("/configuracion/mailing");
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// =====================================================================
// SUSCRIPCIÓN (marketing) — doble opt-in
// =====================================================================

export async function subscribeEmailToListAction(input: {
  list_id: string;
  email: string;
  customer_id?: string;
  lead_id?: string;
  source?: string;
}): Promise<{ pending: boolean; confirmation_sent: boolean }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const email = input.email.trim().toLowerCase();
  const token = crypto.randomBytes(24).toString("base64url");

  const { error } = await admin
    .from("email_subscriptions")
    .upsert(
      {
        company_id: session.company_id,
        list_id: input.list_id,
        email,
        customer_id: input.customer_id ?? null,
        lead_id: input.lead_id ?? null,
        status: "pending_confirmation",
        confirmation_token: token,
        source: input.source ?? "manual",
      },
      { onConflict: "list_id,email" },
    );
  if (error) throw new Error(error.message);

  // TODO: enviar email de confirmación con link /confirmar-suscripcion?token=...
  return { pending: true, confirmation_sent: false };
}

export async function unsubscribeByTokenAction(
  token: string,
): Promise<{ ok: boolean; email?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: t } = await admin
    .from("email_unsubscribe_tokens")
    .select("id, email, list_id, used_at, expires_at, company_id")
    .eq("token", token)
    .maybeSingle();
  if (!t) return { ok: false };
  if (t.used_at) return { ok: true, email: t.email };
  if (t.expires_at && new Date(t.expires_at) < new Date()) {
    return { ok: false };
  }

  // Marcar token como usado
  await admin
    .from("email_unsubscribe_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", t.id);

  // Desuscribir: si list_id null → de TODAS las listas de la empresa
  let q = admin
    .from("email_subscriptions")
    .update({
      status: "unsubscribed",
      unsubscribed_at: new Date().toISOString(),
      unsubscribed_reason: "user_request",
    })
    .eq("email", t.email)
    .eq("company_id", t.company_id);
  if (t.list_id) q = q.eq("list_id", t.list_id);
  await q;

  // Audit consent
  await admin.from("email_consents").insert({
    company_id: t.company_id,
    email: t.email,
    scope: "marketing",
    action: "revoked",
    source: "unsubscribe_link",
  });

  return { ok: true, email: t.email };
}

void buildSignatureHtml; // re-export para que el linter no se queje cuando se use en otros sitios

// =================== Safe wrappers ===================

export async function setMyEmailSettingsSafeAction(input: {
  from_email: string;
  from_name?: string;
  signature_html?: string;
}): Promise<{ ok: true } | { ok: false; error: string; partial?: boolean }> {
  try {
    await setMyEmailSettingsAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
