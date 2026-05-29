"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sendViaSmtp, type TriggerEvent } from "@/modules/mailing/smtp";

/**
 * Variante de sendIncidentEmail que NO necesita sesión (para usar desde cron).
 * Hace el envío directo vía SMTP usando la cuenta SMTP automatizada de la
 * empresa (smtp_automated_*, con fallback a smtp_company_*).
 */
export async function sendIncidentEmailFromCron(
  incidentId: string,
  templateKey: "incident_assigned" | "incident_sla_warning" | "incident_resolved",
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inc } = await admin
    .from("incidents")
    .select(
      "id, company_id, customer_id, title, deadline_at, created_at, resolved_at, assigned_user_id",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (!inc) return;
  const i = inc as {
    id: string;
    company_id: string;
    customer_id: string | null;
    title: string;
    deadline_at: string | null;
    created_at: string;
    resolved_at: string | null;
    assigned_user_id: string | null;
  };
  if (!i.customer_id) return;

  // RGPD: sólo enviar si el cliente tiene activo el consentimiento de
  // tratamiento de datos. Es un email transaccional, no marketing —
  // por eso NO se requiere consentimiento commercial.
  const { data: consent } = await admin
    .from("customer_consents")
    .select("granted")
    .eq("customer_id", i.customer_id)
    .eq("kind", "data_processing")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (consent && (consent as { granted: boolean }).granted === false) return;

  const { data: cust } = await admin
    .from("customers")
    .select("email, first_name, last_name, trade_name, legal_name, party_kind")
    .eq("id", i.customer_id)
    .maybeSingle();
  const c = cust as {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    party_kind: "individual" | "company";
  } | null;
  if (!c?.email) return;
  const customerName =
    c.party_kind === "company"
      ? c.trade_name || c.legal_name || "Cliente"
      : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";

  // Plantilla: per-empresa; si no existe, caer al catálogo de sistema (igual
  // que el resto de envíos) para que una empresa sin seed igualmente avise.
  const { data: tplRow } = await admin
    .from("email_templates")
    .select("id, subject, body_html, kind")
    .eq("company_id", i.company_id)
    .eq("key", templateKey)
    .eq("is_active", true)
    .maybeSingle();
  let tplId: string | null = null;
  let tplSubject = "";
  let tplBody = "";
  let tplKind = "transactional";
  if (tplRow) {
    const tr = tplRow as {
      id: string;
      subject: string;
      body_html: string;
      kind: string;
    };
    tplId = tr.id;
    tplSubject = tr.subject;
    tplBody = tr.body_html;
    tplKind = tr.kind;
  } else {
    const { getSystemTemplateByKey } = await import(
      "@/modules/mailing/system-templates"
    );
    const sys = getSystemTemplateByKey(templateKey);
    if (!sys) return;
    tplSubject = sys.subject;
    tplBody = sys.body_html;
  }

  let technicianName = "Nuestro técnico";
  if (i.assigned_user_id) {
    const { data: t } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", i.assigned_user_id)
      .maybeSingle();
    technicianName = (t as { full_name?: string } | null)?.full_name ?? technicianName;
  }
  const { data: cs } = await admin
    .from("company_settings")
    .select("fiscal_phone")
    .eq("company_id", i.company_id)
    .maybeSingle();

  const variables: Record<string, string | number> = {
    customer_name: customerName,
    incident_title: i.title,
    technician_name: technicianName,
    deadline_at: i.deadline_at
      ? new Date(i.deadline_at).toLocaleString("es-ES")
      : "—",
    company_phone: (cs as { fiscal_phone?: string } | null)?.fiscal_phone ?? "—",
  };
  if (templateKey === "incident_resolved" && i.resolved_at) {
    const hours =
      (new Date(i.resolved_at).getTime() - new Date(i.created_at).getTime()) /
      (1000 * 60 * 60);
    variables.resolution_hours = hours.toFixed(1);
  }

  // Render simple {{var}}
  function render(s: string): string {
    return s.replace(/\{\{(\w+)\}\}/g, (_m, key) =>
      variables[key] !== undefined ? String(variables[key]) : `{{${key}}}`,
    );
  }

  const subject = render(tplSubject);
  // Envolver en la plantilla HTML con marca + cabecera + pie legal de la
  // empresa, igual que el resto de envíos (antes iba el cuerpo "pelado").
  const { loadCompanyEmailContext } = await import(
    "@/modules/mailing/company-context"
  );
  const ctx = await loadCompanyEmailContext(i.company_id, admin);
  const { buildEmailHtml } = await import("@/modules/mailing/templates");
  const html = buildEmailHtml({
    body_html: render(tplBody),
    company: ctx.company,
    branding: ctx.branding,
    kind: "transactional",
  });

  const result = await sendViaSmtp({
    companyId: i.company_id,
    senderUserId: null,
    to: c.email,
    toName: customerName,
    subject,
    html,
    sendType: "automated",
    triggerEvent: "incident_notification" as TriggerEvent,
    relatedType: "incident",
    relatedId: i.id,
  });

  await admin.from("email_sends").insert({
    company_id: i.company_id,
    template_id: tplId,
    template_key: templateKey,
    kind: tplKind,
    to_email: c.email,
    to_name: customerName,
    subject,
    body_html: html,
    customer_id: i.customer_id,
    related_subject_type: "incident",
    related_subject_id: i.id,
    status: result.ok ? "sent" : "failed",
    error_message: result.ok ? null : result.error,
    sent_at: result.ok ? new Date().toISOString() : null,
    send_type: "automated",
    trigger_event: "incident_notification",
    from_account_type: result.ok ? result.accountType : null,
    resend_id: result.ok ? result.resend_id ?? null : null,
  });
}
