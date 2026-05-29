"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { z } from "zod";
import { renderTemplate, buildEmailHtml } from "./templates";
import { loadCompanyEmailContext } from "./company-context";
import { sendViaSmtp } from "./smtp";
import { hasActiveConsent } from "@/modules/customers/consents-actions";
import { listEphemerides, type Ephemeris } from "@/modules/social/actions";

// Solo el departamento de telemarketing (+ admin para configurar) gestiona campañas.
const MAILING_ROLES = ["company_admin", "telemarketing_director", "telemarketer"];

async function ensureMailing() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.some((r) => MAILING_ROLES.includes(r))) {
    throw new Error("Solo el departamento de telemarketing puede gestionar campañas");
  }
  return session;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export interface CampaignListItem {
  id: string;
  name: string;
  status: string;
  template_id: string;
  template_name: string | null;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  sent_at: string | null;
  created_at: string;
}

export async function listCampaignsAction(): Promise<CampaignListItem[]> {
  const session = await ensureMailing();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("email_campaigns")
    .select(
      "id, name, status, template_id, total_recipients, total_sent, total_failed, sent_at, created_at, email_templates(name)",
    )
    .eq("company_id", session.company_id)
    .order("created_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as string,
    template_id: r.template_id as string,
    template_name:
      (r.email_templates as { name: string } | null)?.name ?? null,
    total_recipients: Number(r.total_recipients ?? 0),
    total_sent: Number(r.total_sent ?? 0),
    total_failed: Number(r.total_failed ?? 0),
    sent_at: (r.sent_at as string | null) ?? null,
    created_at: r.created_at as string,
  }));
}

export interface MarketingTemplateOption {
  id: string;
  name: string;
  key: string | null;
}

export async function listMarketingTemplatesAction(): Promise<MarketingTemplateOption[]> {
  const session = await ensureMailing();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Plantillas de la empresa o del sistema, activas. Campañas = marketing.
  const { data } = await admin
    .from("email_templates")
    .select("id, name, key, company_id, kind, is_active")
    .or(`company_id.eq.${session.company_id},company_id.is.null`)
    .eq("is_active", true)
    .eq("kind", "marketing")
    .order("name");
  return ((data ?? []) as Array<{ id: string; name: string; key: string | null }>).map(
    (t) => ({ id: t.id, name: t.name, key: t.key }),
  );
}

const createSchema = z.object({
  name: z.string().min(2, "Nombre demasiado corto"),
  template_id: z.string().uuid("Plantilla inválida"),
});

export async function createCampaignAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await ensureMailing();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(createSchema, input, "Campaña");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Validar que la plantilla existe y es accesible por la empresa.
    const { data: tpl } = await admin
      .from("email_templates")
      .select("id, company_id")
      .eq("id", parsed.template_id)
      .maybeSingle();
    if (!tpl || (tpl.company_id && tpl.company_id !== session.company_id)) {
      return { ok: false, error: "Plantilla no encontrada" };
    }
    const { data, error } = await admin
      .from("email_campaigns")
      .insert({
        company_id: session.company_id,
        name: parsed.name,
        template_id: parsed.template_id,
        status: "draft",
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "No se pudo crear" };
    revalidatePath("/mailing/campanas");
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/** Cuenta destinatarios elegibles: clientes con email + consentimiento comercial. */
export async function previewCampaignAudienceAction(): Promise<{ count: number }> {
  const session = await ensureMailing();
  if (!session.company_id) return { count: 0 };
  const recipients = await resolveAudience(session.company_id);
  return { count: recipients.length };
}

interface Recipient {
  customer_id: string;
  email: string;
  name: string;
}

async function resolveAudience(companyId: string): Promise<Recipient[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: customers } = await admin
    .from("customers")
    .select("id, email, party_kind, legal_name, trade_name, first_name, last_name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .not("email", "is", null)
    .limit(5000);
  const out: Recipient[] = [];
  for (const c of (customers ?? []) as Array<Record<string, unknown>>) {
    const email = (c.email as string | null)?.trim();
    if (!email) continue;
    // RGPD: solo a quien tenga consentimiento comercial activo.
    const ok = await hasActiveConsent(c.id as string, "commercial");
    if (!ok) continue;
    const name =
      (c.party_kind === "company"
        ? (c.legal_name as string) || (c.trade_name as string)
        : [c.first_name, c.last_name].filter(Boolean).join(" ")) || email;
    out.push({ customer_id: c.id as string, email, name });
    if (out.length >= 2000) break; // cap de seguridad MVP
  }
  return out;
}

export async function sendCampaignAction(
  campaignId: string,
): Promise<{ ok: true; sent: number; failed: number; recipients: number } | { ok: false; error: string }> {
  try {
    const session = await ensureMailing();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: campaign } = await admin
      .from("email_campaigns")
      .select("id, company_id, name, template_id, status")
      .eq("id", campaignId)
      .maybeSingle();
    if (!campaign || campaign.company_id !== session.company_id) {
      return { ok: false, error: "Campaña no encontrada" };
    }
    if (campaign.status === "sending" || campaign.status === "sent") {
      return { ok: false, error: "La campaña ya se envió o se está enviando" };
    }

    const { data: tpl } = await admin
      .from("email_templates")
      .select("id, subject, body_html, kind")
      .eq("id", campaign.template_id)
      .maybeSingle();
    if (!tpl) return { ok: false, error: "Plantilla no encontrada" };

    // Datos de empresa para el pie legal + branding (logo/color).
    const ctx = await loadCompanyEmailContext(session.company_id, admin);

    const recipients = await resolveAudience(session.company_id);
    // Marcar como enviando + nº destinatarios.
    await admin
      .from("email_campaigns")
      .update({ status: "sending", total_recipients: recipients.length })
      .eq("id", campaignId);

    const base = appBaseUrl();
    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
      const vars = {
        company_name: ctx.company.legal_name ?? "Nuestra empresa",
        customer_name: r.name,
        customer_first_name: r.name.split(" ")[0] ?? "",
      };
      const subject = renderTemplate(tpl.subject as string, vars);
      const bodyRendered = renderTemplate(tpl.body_html as string, vars);

      // Token de baja (RFC 8058) — obligatorio en marketing.
      const token = crypto.randomBytes(24).toString("hex");
      await admin.from("email_unsubscribe_tokens").insert({
        token,
        company_id: session.company_id,
        email: r.email,
        list_id: null,
      });
      const unsubUrl = `${base}/baja?token=${token}`;
      const bodyWithUnsub = `${bodyRendered}<p style="margin-top:24px;font-size:12px;color:#888">Si no quieres recibir más comunicaciones comerciales, <a href="${unsubUrl}">date de baja aquí</a>.</p>`;

      const html = buildEmailHtml({
        body_html: bodyWithUnsub,
        signature_html: null,
        company: ctx.company,
        branding: ctx.branding,
        kind: "marketing",
      });

      const res = await sendViaSmtp({
        companyId: session.company_id,
        senderUserId: session.user_id,
        to: r.email,
        toName: r.name,
        subject,
        html,
        sendType: "campaign",
        triggerEvent: "campaign_send",
        relatedType: "customer",
        relatedId: r.customer_id,
        replyTo: session.email ?? undefined,
      });

      try {
        await admin.from("email_sends").insert({
          company_id: session.company_id,
          user_id: session.user_id,
          template_id: tpl.id,
          campaign_id: campaignId,
          to_email: r.email,
          to_name: r.name,
          customer_id: r.customer_id,
          from_email: ctx.company.email ?? "",
          from_name: ctx.company.legal_name ?? "",
          subject,
          body_html: html,
          kind: "marketing",
          status: res.ok ? "sent" : "failed",
          error_message: res.ok ? null : res.error,
          sent_at: res.ok ? new Date().toISOString() : null,
          send_type: "campaign",
          trigger_event: "campaign_send",
          from_account_type: res.ok ? res.accountType : null,
          resend_id: res.ok ? res.resend_id ?? null : null,
        });
      } catch {
        /* fail-soft del registro */
      }

      if (res.ok) sent++;
      else failed++;
    }

    await admin
      .from("email_campaigns")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        total_recipients: recipients.length,
        total_sent: sent,
        total_failed: failed,
      })
      .eq("id", campaignId);

    revalidatePath("/mailing/campanas");
    return { ok: true, sent, failed, recipients: recipients.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export interface EphemerisSuggestion {
  slug: string;
  name: string;
  date_label: string;
  in_days: number;
  importance: string;
  description: string | null;
}

/** Próximas efemérides (≤60 días) para sugerir campañas. */
export async function getEphemerisSuggestionsAction(): Promise<EphemerisSuggestion[]> {
  await ensureMailing();
  let all: Ephemeris[] = [];
  try {
    all = await listEphemerides();
  } catch {
    return [];
  }
  const now = new Date();
  const year = now.getFullYear();
  const MONTHS = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const withDates = all.map((e) => {
    // Próxima ocurrencia (este año o el siguiente).
    let d = new Date(year, e.month_of_year - 1, e.day_of_month);
    if (d.getTime() < now.getTime() - 86400000) {
      d = new Date(year + 1, e.month_of_year - 1, e.day_of_month);
    }
    const inDays = Math.round((d.getTime() - now.getTime()) / 86400000);
    return { e, d, inDays };
  });
  return withDates
    .filter((x) => x.inDays >= 0 && x.inDays <= 60)
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 12)
    .map((x) => ({
      slug: x.e.slug,
      name: x.e.name,
      date_label: `${x.e.day_of_month} ${MONTHS[x.e.month_of_year - 1]}`,
      in_days: x.inDays,
      importance: x.e.importance,
      description: x.e.description,
    }));
}
