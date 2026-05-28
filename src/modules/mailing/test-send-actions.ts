"use server";

import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sendViaSmtp } from "./smtp";
import { renderTemplate, buildEmailHtml } from "./templates";
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
    const { data: companyRow } = await admin
      .from("companies")
      .select("name")
      .eq("id", session.company_id)
      .maybeSingle();
    const { data: cs } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_email, fiscal_phone",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const csRow = (cs ?? {}) as {
      fiscal_legal_name?: string | null;
      fiscal_tax_id?: string | null;
      fiscal_street?: string | null;
      fiscal_email?: string | null;
      fiscal_phone?: string | null;
    };

    const sampleVars: Record<string, string | number> = {
      customer_first_name: "Mario",
      customer_name: "Mario Ortigueira",
      customer_address: "Avenida de la Paz 14, 28012 Madrid",
      customer_email: toEmail,
      customer_phone: "612 345 678",
      company_name:
        (companyRow as { name: string | null } | null)?.name ?? "AguaClaude",
      company_email: csRow.fiscal_email ?? "info@aguaclaude.es",
      company_phone: csRow.fiscal_phone ?? "900 100 200",
      appointment_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
      appointment_time: "10:00",
      technician_name: "Juan García",
      proposal_reference: "PROP-2026-0042",
      proposal_total: 89000,
      proposal_validity_days: 30,
      contract_ref: "CTR-2026-0042",
      sign_url: "https://example.com/firma/abc123xyz",
      days_to_expire: 7,
      invoice_number: "F2026/0042",
      invoice_total: 12500,
      invoice_due_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
      confirm_url: "https://example.com/m/abc123xyz",
      discount_amount: 5000,
      savings_amount: 24500,
      promo_code: "VERANO2026",
      years_with_us: 3,
    };

    const company = {
      legal_name: csRow.fiscal_legal_name ?? "AguaClaude Demo SL",
      tax_id: csRow.fiscal_tax_id ?? "B12345678",
      address: csRow.fiscal_street,
      email: csRow.fiscal_email,
      phone: csRow.fiscal_phone,
    };

    let sent = 0;
    let failed = 0;
    for (const t of getSystemTemplates()) {
      const subject = `[TEST] ${renderTemplate(t.subject, sampleVars)}`;
      const body = renderTemplate(t.body_html, sampleVars);
      const fullHtml = buildEmailHtml({
        body_html: body,
        company,
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
          from_email: csRow.fiscal_email ?? "",
          from_name:
            (companyRow as { name: string | null } | null)?.name ?? "AguaClaude",
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
