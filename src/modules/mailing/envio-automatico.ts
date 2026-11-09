import "server-only";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { renderTemplate, buildEmailHtml } from "./templates";
import { loadCompanyEmailContext } from "./company-context";
import { getSystemTemplateByKey } from "./system-templates";
import { sendViaSmtp, type TriggerEvent } from "./smtp";

/**
 * Envío transaccional SIN sesión, para crons y procesos del sistema.
 *
 * `sendTransactionalEmail` (actions.ts) exige `requireSession()` y por eso
 * fallaba siempre dentro de un cron. Este fichero NO es "use server": no se
 * expone como server action, así que puede recibir el `companyId` por
 * parámetro sin abrir una puerta entre empresas.
 */
export interface EnvioAutomaticoInput {
  companyId: string;
  templateKey: string;
  toEmail: string;
  toName?: string;
  customerId?: string | null;
  variables?: Record<string, unknown>;
  triggerEvent: TriggerEvent;
  relatedType?: string;
  relatedId?: string;
}

export async function enviarCorreoAutomatico(
  input: EnvioAutomaticoInput,
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Plantilla: la de la empresa si existe y está activa; si no, la del sistema.
  const { data: tplRow, error: tplError } = await admin
    .from("email_templates")
    .select("subject, body_html, kind")
    .eq("company_id", input.companyId)
    .eq("key", input.templateKey)
    .eq("is_active", true)
    .maybeSingle();
  if (tplError) return { ok: false, error: tplError.message };
  let tpl = tplRow as
    | { subject: string; body_html: string; kind: "transactional" | "marketing" }
    | null;
  if (!tpl) {
    const sys = getSystemTemplateByKey(input.templateKey);
    if (sys) tpl = { subject: sys.subject, body_html: sys.body_html, kind: sys.kind };
  }
  if (!tpl) return { ok: false, error: `Plantilla "${input.templateKey}" no encontrada` };
  // Un proceso automático nunca manda comerciales: no hay consentimiento que mirar aquí.
  if (tpl.kind === "marketing") {
    return { ok: false, error: "Un envío automático no puede usar una plantilla comercial" };
  }

  // RGPD: si el cliente revocó el tratamiento de datos, no se le manda nada.
  if (input.customerId) {
    const { data: dpRow, error: dpError } = await admin
      .from("customer_consents")
      .select("granted")
      .eq("customer_id", input.customerId)
      .eq("company_id", input.companyId)
      .eq("kind", "data_processing")
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dpError) return { ok: false, error: dpError.message };
    if (dpRow && (dpRow as { granted: boolean }).granted === false) {
      return { ok: false, error: "El cliente revocó el tratamiento de datos (RGPD)" };
    }
  }

  const ctx = await loadCompanyEmailContext(input.companyId, admin);
  const vars = {
    company_name: ctx.company.legal_name ?? "Nuestra empresa",
    customer_name: input.toName ?? "",
    customer_first_name: input.toName?.split(" ")[0] ?? "",
    ...input.variables,
  };
  const subject = renderTemplate(tpl.subject, vars);
  const html = buildEmailHtml({
    body_html: renderTemplate(tpl.body_html, vars),
    company: ctx.company,
    branding: ctx.branding,
    kind: "transactional",
  });

  const result = await sendViaSmtp({
    companyId: input.companyId,
    senderUserId: null, // sistema
    to: input.toEmail,
    toName: input.toName,
    subject,
    html,
    sendType: "automated",
    triggerEvent: input.triggerEvent,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
  });

  // Registro en email_sends para que salga en el dashboard de mailing.
  const { error: insError } = await admin.from("email_sends").insert({
    company_id: input.companyId,
    template_key: input.templateKey,
    to_email: input.toEmail,
    to_name: input.toName ?? null,
    customer_id: input.customerId ?? null,
    from_email: ctx.company.email ?? "",
    from_name: ctx.company.legal_name ?? "Hidromanager",
    subject,
    body_html: html,
    kind: "transactional",
    status: result.ok ? "sent" : "failed",
    error_message: result.ok ? null : result.error,
    sent_at: result.ok ? new Date().toISOString() : null,
    related_subject_type: input.relatedType ?? null,
    related_subject_id: input.relatedId ?? null,
    send_type: "automated",
    trigger_event: input.triggerEvent,
    from_account_type: result.ok ? result.accountType : null,
    resend_id: result.ok ? result.resend_id ?? null : null,
  });
  if (insError) console.error("[envio-automatico] email_sends insert:", insError.message);

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
