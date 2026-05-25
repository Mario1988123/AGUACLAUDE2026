import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sendEmailViaResend } from "@/modules/mailing/resend";
import { renderTemplate, buildEmailHtml } from "@/modules/mailing/templates";
import { getSystemTemplateByKey } from "@/modules/mailing/system-templates";
import { ensureConfirmationToken } from "@/modules/maintenance/public-confirmation-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cron diario que busca mantenimientos y envía dos tipos de recordatorios
 * por email al cliente:
 *
 *  1. **14 días antes** — para jobs `scheduled` con scheduled_at ∈ [13d, 15d].
 *     Plantilla `maintenance_confirm_request`. Permite al cliente confirmar,
 *     elegir otra fecha o posponer (vía deep-link público /m/[token]).
 *
 *  2. **Víspera (24h antes)** — para jobs `scheduled` con scheduled_at ∈
 *     [23h, 25h]. Plantilla `maintenance_day_before`. Permite reconfirmar
 *     o posponer.
 *
 * Idempotente: cada job tiene `customer_reminder_sent_at` y
 * `customer_day_before_sent_at` que evitan duplicados.
 *
 * Auth: header `x-cron-secret` o `Authorization: Bearer CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (secret) {
    const ok = auth === `Bearer ${secret}` || xCron === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { confirm_request: 0, day_before: 0, errors: 0 };

  // === 1) Recordatorio "confirma tu próxima visita" (14 días antes) ===
  try {
    const from = new Date(Date.now() + 13 * 86400_000);
    const to = new Date(Date.now() + 15 * 86400_000);
    const { data: jobs } = await admin
      .from("maintenance_jobs")
      .select("id, company_id, customer_id, scheduled_at, technician_user_id")
      .eq("status", "scheduled")
      .is("customer_reminder_sent_at", null)
      .gte("scheduled_at", from.toISOString())
      .lte("scheduled_at", to.toISOString())
      .limit(200);
    for (const j of (jobs ?? []) as Array<{
      id: string;
      company_id: string;
      customer_id: string;
      scheduled_at: string;
      technician_user_id: string | null;
    }>) {
      const sent = await sendMaintenanceReminder(
        admin,
        j,
        "maintenance_confirm_request",
      );
      if (sent) {
        await admin
          .from("maintenance_jobs")
          .update({ customer_reminder_sent_at: new Date().toISOString() })
          .eq("id", j.id);
        stats.confirm_request++;
      } else {
        stats.errors++;
      }
    }
  } catch (e) {
    console.error("[cron/maintenance-reminders] 14d block", e);
  }

  // === 2) Recordatorio víspera (24h antes) ===
  try {
    const from = new Date(Date.now() + 23 * 3600_000);
    const to = new Date(Date.now() + 25 * 3600_000);
    const { data: jobs } = await admin
      .from("maintenance_jobs")
      .select("id, company_id, customer_id, scheduled_at, technician_user_id")
      .eq("status", "scheduled")
      .is("customer_day_before_sent_at", null)
      .gte("scheduled_at", from.toISOString())
      .lte("scheduled_at", to.toISOString())
      .limit(200);
    for (const j of (jobs ?? []) as Array<{
      id: string;
      company_id: string;
      customer_id: string;
      scheduled_at: string;
      technician_user_id: string | null;
    }>) {
      const sent = await sendMaintenanceReminder(
        admin,
        j,
        "maintenance_day_before",
      );
      if (sent) {
        await admin
          .from("maintenance_jobs")
          .update({ customer_day_before_sent_at: new Date().toISOString() })
          .eq("id", j.id);
        stats.day_before++;
      } else {
        stats.errors++;
      }
    }
  } catch (e) {
    console.error("[cron/maintenance-reminders] 24h block", e);
  }

  return NextResponse.json({ ok: true, stats });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendMaintenanceReminder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  job: {
    id: string;
    company_id: string;
    customer_id: string;
    scheduled_at: string;
    technician_user_id: string | null;
  },
  templateKey: "maintenance_confirm_request" | "maintenance_day_before",
): Promise<boolean> {
  // Cliente + email
  const { data: customer } = await admin
    .from("customers")
    .select("email, first_name, last_name, trade_name, legal_name, party_kind")
    .eq("id", job.customer_id)
    .maybeSingle();
  const c = customer as {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    trade_name: string | null;
    legal_name: string | null;
    party_kind: string | null;
  } | null;
  if (!c?.email) return false;

  // RGPD — data_processing
  const { data: dp } = await admin
    .from("customer_consents")
    .select("granted")
    .eq("customer_id", job.customer_id)
    .eq("kind", "data_processing")
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dp && (dp as { granted: boolean }).granted === false) return false;

  // Empresa
  const { data: company } = await admin
    .from("companies")
    .select("name")
    .eq("id", job.company_id)
    .maybeSingle();
  const { data: cs } = await admin
    .from("company_settings")
    .select(
      "fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_email, fiscal_phone",
    )
    .eq("company_id", job.company_id)
    .maybeSingle();

  // Dirección principal
  const { data: addr } = await admin
    .from("addresses")
    .select("street_type, street, street_number, postal_code, city")
    .eq("customer_id", job.customer_id)
    .eq("is_primary", true)
    .maybeSingle();
  const a = addr as
    | {
        street_type: string | null;
        street: string | null;
        street_number: string | null;
        postal_code: string | null;
        city: string | null;
      }
    | null;
  const customerAddress = a?.street
    ? `${a.street_type ? a.street_type + " " : ""}${a.street}${a.street_number ? " " + a.street_number : ""}${a.postal_code ? ", " + a.postal_code : ""}${a.city ? " " + a.city : ""}`
    : "";

  // Técnico
  let technicianName = "Nuestro técnico";
  if (job.technician_user_id) {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", job.technician_user_id)
      .maybeSingle();
    const fn = (prof as { full_name: string | null } | null)?.full_name;
    if (fn) technicianName = fn;
  }

  // Token público
  const token = await ensureConfirmationToken(job.id);
  if (!token) return false;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://crm.example.com";
  const confirmUrl = `${baseUrl}/m/${token}`;

  const firstName =
    c.party_kind === "company"
      ? c.trade_name ?? c.legal_name ?? "Cliente"
      : c.first_name ?? "Cliente";
  const customerName =
    c.party_kind === "company"
      ? c.trade_name ?? c.legal_name ?? "Cliente"
      : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";

  const scheduled = new Date(job.scheduled_at);
  const variables: Record<string, string> = {
    customer_first_name: firstName,
    company_name: (company as { name: string | null } | null)?.name ?? "",
    appointment_date: scheduled.toISOString(),
    appointment_time: scheduled.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    customer_address: customerAddress,
    technician_name: technicianName,
    confirm_url: confirmUrl,
  };

  // Plantilla: BD primero, sistema fallback
  let subject = "";
  let bodyHtml = "";
  const { data: tplRow } = await admin
    .from("email_templates")
    .select("subject, body_html")
    .eq("company_id", job.company_id)
    .eq("key", templateKey)
    .eq("is_active", true)
    .maybeSingle();
  if (tplRow) {
    const tp = tplRow as { subject: string; body_html: string };
    subject = renderTemplate(tp.subject, variables);
    bodyHtml = renderTemplate(tp.body_html, variables);
  } else {
    const sys = getSystemTemplateByKey(templateKey);
    if (!sys) return false;
    subject = renderTemplate(sys.subject, variables);
    bodyHtml = renderTemplate(sys.body_html, variables);
  }

  const csRow = (cs ?? {}) as {
    fiscal_legal_name?: string | null;
    fiscal_tax_id?: string | null;
    fiscal_street?: string | null;
    fiscal_email?: string | null;
    fiscal_phone?: string | null;
  };
  const fullHtml = buildEmailHtml({
    body_html: bodyHtml,
    company: {
      legal_name: csRow.fiscal_legal_name ?? "—",
      tax_id: csRow.fiscal_tax_id ?? "—",
      address: csRow.fiscal_street ?? null,
      email: csRow.fiscal_email ?? null,
      phone: csRow.fiscal_phone ?? null,
    },
    kind: "transactional",
  });

  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    csRow.fiscal_email ??
    "onboarding@resend.dev";
  const fromName =
    (company as { name: string | null } | null)?.name ?? "AguaClaude";

  const result = await sendEmailViaResend({
    from_email: fromEmail,
    from_name: fromName,
    to_email: c.email,
    to_name: customerName,
    subject,
    body_html: fullHtml,
  });

  await admin.from("email_sends").insert({
    company_id: job.company_id,
    template_key: templateKey,
    to_email: c.email,
    to_name: customerName,
    customer_id: job.customer_id,
    from_email: fromEmail,
    from_name: fromName,
    subject,
    body_html: fullHtml,
    kind: "transactional",
    status: result.ok ? "sent" : "failed",
    resend_id: result.resend_id,
    error_code: result.error_code,
    error_message: result.error_message,
    sent_at: result.ok ? new Date().toISOString() : null,
    related_subject_type: "maintenance",
    related_subject_id: job.id,
  });

  return result.ok;
}
