"use server";

import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sendViaSmtp } from "./smtp";
import { renderTemplate, buildEmailHtml } from "./templates";
import { loadCompanyEmailContext } from "./company-context";
import { getSampleVars } from "./sample-vars";
import { getSystemTemplates } from "./system-templates";

/**
 * Manda TODAS las plantillas del sistema (12+) al email indicado con
 * datos de muestra. Útil para ver los diseños reales en el cliente de
 * correo en lugar del iframe del preview.
 *
 * Solo company_admin / superadmin. Marca los envíos como
 * `test=true` en la metadata del payload del registro `email_sends`.
 */
export async function sendAllTemplatesTestAction(
  toEmail: string,
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin de empresa" };
    }
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim())) {
      return { ok: false, error: "Email destino inválido" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const ctx = await loadCompanyEmailContext(session.company_id, admin);
    const sampleVars = getSampleVars({
      customer_email: toEmail,
      company_name: ctx.company.legal_name,
      company_email: ctx.company.email ?? "info@aguaclaude.es",
      company_phone: ctx.company.phone ?? "900 100 200",
    });

    let sent = 0;
    let failed = 0;
    for (const t of getSystemTemplates()) {
      const subject = `[TEST] ${renderTemplate(t.subject, sampleVars)}`;
      const body = renderTemplate(t.body_html, sampleVars);
      const fullHtml = buildEmailHtml({
        body_html: body,
        company: ctx.company,
        branding: ctx.branding,
        kind: t.kind,
      });
      // sendViaSmtp registra automáticamente en email_outbox.
      // Para que aparezca también en email_sends (que es lo que el módulo MAIL
      // y mailing dashboard consultan), insertamos a mano. El envío real lo
      // hace sendViaSmtp con la cuenta SMTP del admin.
      const result = await sendViaSmtp({
        companyId: session.company_id,
        senderUserId: session.user_id,
        to: toEmail,
        subject,
        html: fullHtml,
        sendType: "manual",
        triggerEvent: "test_send",
      });
      try {
        await admin.from("email_sends").insert({
          company_id: session.company_id,
          user_id: session.user_id,
          template_key: t.key,
          to_email: toEmail,
          from_email: ctx.company.email ?? "",
          from_name: ctx.company.legal_name,
          subject,
          body_html: fullHtml,
          kind: t.kind,
          status: result.ok ? "sent" : "failed",
          error_message: result.ok ? null : result.error,
          sent_at: result.ok ? new Date().toISOString() : null,
          send_type: "manual",
          trigger_event: "test_send",
          from_account_type: result.ok ? result.accountType : null,
          resend_id: result.ok ? result.resend_id ?? null : null,
        });
      } catch {
        /* fail-soft logging */
      }
      if (result.ok) sent++;
      else failed++;
    }
    return { ok: true, sent, failed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
