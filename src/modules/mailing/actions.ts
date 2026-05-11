"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  createOrFetchDomain,
  verifyDomain,
  sendEmailViaResend,
  isResendConfigured,
} from "./resend";
import {
  renderTemplate,
  buildEmailHtml,
  buildSignatureHtml,
} from "./templates";
import { getSystemTemplates } from "./system-templates";

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
// DOMINIOS
// =====================================================================

export interface DomainStatus {
  id: string | null;
  domain: string | null;
  status: string;
  records: Array<{ type: string; name: string; value: string; status: string }>;
  verified_at: string | null;
  failure_reason: string | null;
}

export async function getMailingDomain(): Promise<DomainStatus | null> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("email_domains")
    .select("id, domain, status, dkim_record, spf_record, dmarc_record, verified_at, failure_reason, resend_domain_id")
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const records: DomainStatus["records"] = [];
  if (data.dkim_record) {
    try {
      const parsed = JSON.parse(data.dkim_record);
      if (Array.isArray(parsed)) records.push(...parsed);
    } catch {
      /* legacy format */
    }
  }
  return {
    id: data.id,
    domain: data.domain,
    status: data.status,
    records,
    verified_at: data.verified_at,
    failure_reason: data.failure_reason,
  };
}

export async function addMailingDomainAction(domain: string): Promise<void> {
  const session = await ensureAdmin();
  const cleanDomain = domain.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/.test(cleanDomain)) {
    throw new Error("Dominio inválido. Ejemplo: aguasl.com");
  }
  if (!isResendConfigured()) {
    throw new Error(
      "Mailing no configurado en el servidor. Pide al equipo técnico que añada RESEND_API_KEY.",
    );
  }
  const result = await createOrFetchDomain(cleanDomain);
  if (result.error) {
    throw new Error(`No se pudo registrar el dominio: ${result.error}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Borrar previos del mismo dominio
  await admin
    .from("email_domains")
    .delete()
    .eq("company_id", session.company_id)
    .eq("domain", cleanDomain);

  await admin.from("email_domains").insert({
    company_id: session.company_id,
    domain: cleanDomain,
    resend_domain_id: result.resend_domain_id,
    status: result.status === "verified" ? "verified" : "pending",
    dkim_record: JSON.stringify(result.records),
    verified_at: result.status === "verified" ? new Date().toISOString() : null,
    last_check_at: new Date().toISOString(),
  });

  revalidatePath("/configuracion/mailing");
}

export async function verifyMailingDomainAction(): Promise<{ status: string }> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: dom } = await admin
    .from("email_domains")
    .select("id, resend_domain_id")
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!dom) throw new Error("No hay dominio configurado");
  if (!dom.resend_domain_id) throw new Error("Dominio sin ID de Resend");

  const r = await verifyDomain(dom.resend_domain_id);
  await admin
    .from("email_domains")
    .update({
      status: r.status === "verified" ? "verified" : r.error ? "failed" : "pending",
      verified_at: r.status === "verified" ? new Date().toISOString() : null,
      last_check_at: new Date().toISOString(),
      failure_reason: r.error,
    })
    .eq("id", dom.id);

  revalidatePath("/configuracion/mailing");
  return { status: r.status };
}

// =====================================================================
// CONFIG USUARIO (su email empresa)
// =====================================================================

export async function getMyEmailSettings(): Promise<{
  from_email: string | null;
  from_name: string | null;
  signature_html: string | null;
  domain_verified: boolean;
} | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: my } = await admin
    .from("email_user_settings")
    .select("from_email, from_name, signature_html")
    .eq("user_id", session.user_id)
    .maybeSingle();
  const { data: dom } = await admin
    .from("email_domains")
    .select("status")
    .eq("company_id", session.company_id)
    .eq("status", "verified")
    .maybeSingle();
  return {
    from_email: my?.from_email ?? null,
    from_name: my?.from_name ?? null,
    signature_html: my?.signature_html ?? null,
    domain_verified: Boolean(dom),
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
  const emailDomain = email.split("@")[1];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Verificar que el dominio del email coincide con el dominio verificado
  const { data: dom } = await admin
    .from("email_domains")
    .select("status, domain")
    .eq("company_id", session.company_id)
    .eq("domain", emailDomain)
    .maybeSingle();

  const isVerified = Boolean(dom && dom.status === "verified");

  const payload = {
    user_id: session.user_id,
    company_id: session.company_id,
    from_email: email,
    from_name: input.from_name?.trim() || null,
    signature_html: input.signature_html?.trim() || null,
    is_verified: isVerified,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("email_user_settings")
    .select("user_id")
    .eq("user_id", session.user_id)
    .maybeSingle();

  if (existing) {
    await admin
      .from("email_user_settings")
      .update(payload)
      .eq("user_id", session.user_id);
  } else {
    await admin.from("email_user_settings").insert(payload);
  }

  if (!isVerified) {
    throw new Error(
      `Guardado, pero el dominio "${emailDomain}" aún no está verificado. Pide al admin que añada y verifique el dominio en /configuracion/mailing.`,
    );
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
 * y footer legal, y lo manda via Resend.
 */
export async function sendTransactionalEmail(
  input: SendTransactionalInput,
): Promise<{ ok: boolean; send_id?: string; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Plantilla
  const { data: tpl } = await admin
    .from("email_templates")
    .select("id, subject, body_html, kind")
    .eq("company_id", session.company_id)
    .eq("key", input.template_key)
    .eq("is_active", true)
    .maybeSingle();
  if (!tpl) {
    return { ok: false, error: `Plantilla "${input.template_key}" no encontrada` };
  }

  // RGPD — si la plantilla es de marketing y el destinatario es un cliente
  // identificado, comprobamos que tenga concedido el consentimiento
  // 'commercial'. Si lo revocó, NO se manda — aunque el flujo lo pidiera.
  if (
    (tpl as { kind: string }).kind === "marketing" &&
    input.customer_id
  ) {
    const { hasActiveConsent } = await import("@/modules/customers/consents-actions");
    const allowed = await hasActiveConsent(input.customer_id, "commercial");
    if (!allowed) {
      return {
        ok: false,
        error: "Cliente sin consentimiento para comunicaciones comerciales (RGPD)",
      };
    }
  }

  // Settings del usuario (su email empresa)
  const { data: userSettings } = await admin
    .from("email_user_settings")
    .select("from_email, from_name, signature_html")
    .eq("user_id", session.user_id)
    .maybeSingle();

  // Datos empresa para footer legal
  const { data: cs } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_email, fiscal_phone",
    )
    .eq("company_id", session.company_id)
    .maybeSingle();

  // Dominio + email genérico fallback (si user no tiene su email configurado)
  const { data: dom } = await admin
    .from("email_domains")
    .select("domain, status")
    .eq("company_id", session.company_id)
    .eq("status", "verified")
    .maybeSingle();

  const fromEmail =
    userSettings?.from_email ??
    (dom?.domain ? `info@${dom.domain}` : null);
  const fromName =
    userSettings?.from_name ??
    cs?.fiscal_legal_name ??
    "AGUACLAUDE";

  if (!fromEmail) {
    return {
      ok: false,
      error:
        "No hay email configurado. El admin debe verificar el dominio en /configuracion/mailing.",
    };
  }

  // Renderizar
  const baseVars = {
    company_name: cs?.fiscal_legal_name ?? "Nuestra empresa",
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
    company: {
      legal_name: cs?.fiscal_legal_name ?? "—",
      tax_id: cs?.fiscal_tax_id ?? "—",
      address: cs?.fiscal_street ?? null,
      email: cs?.fiscal_email ?? null,
      phone: cs?.fiscal_phone ?? null,
    },
    kind: tpl.kind,
  });

  // Enviar
  const result = await sendEmailViaResend({
    from_email: fromEmail,
    from_name: fromName,
    to_email: input.to_email,
    to_name: input.to_name,
    subject,
    body_html: html,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content_base64,
    })),
  });

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
      status: result.ok ? "sent" : "failed",
      resend_id: result.resend_id,
      error_code: result.error_code,
      error_message: result.error_message,
      sent_at: result.ok ? new Date().toISOString() : null,
      attachments_meta:
        input.attachments?.map((a) => ({
          name: a.filename,
        })) ?? [],
      related_subject_type: input.related_subject_type ?? null,
      related_subject_id: input.related_subject_id ?? null,
    })
    .select("id")
    .single();

  const sendId = (sendRow as { id: string } | null)?.id;

  // Insertar evento timeline en events para que aparezca en la ficha
  // del cliente/contrato/propuesta. Fail-soft.
  if (sendId && result.ok) {
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
    ok: result.ok,
    send_id: sendId,
    error: result.error_message ?? undefined,
  };
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
