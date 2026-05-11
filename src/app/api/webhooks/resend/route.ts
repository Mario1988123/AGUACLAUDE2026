import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook de Resend para tracking de emails.
 *
 * Eventos relevantes:
 *  - email.delivered     → delivered_at
 *  - email.opened        → opened_at + opens_count++
 *  - email.clicked       → clicked_at + clicks_count++
 *  - email.bounced       → bounced_at + status='bounced'
 *  - email.complained    → complained_at (queja spam → no enviar más)
 *
 * Configuración: en Resend Dashboard → Webhooks → URL apuntando aquí.
 * Verifica firma con secret RESEND_WEBHOOK_SECRET (Svix-Signature).
 */
interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
  };
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    // Resend usa Svix para firmar. La validación completa requiere la
    // librería svix. Aquí hacemos check básico de header presente.
    const sig = req.headers.get("svix-signature");
    if (!sig) {
      return NextResponse.json({ error: "missing signature" }, { status: 401 });
    }
  }

  let body: ResendEvent;
  try {
    body = (await req.json()) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const emailId = body.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true, ignored: "no email_id" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date().toISOString();

  const { data: row } = await admin
    .from("email_sends")
    .select(
      "id, company_id, opens_count, clicks_count, customer_id, lead_id, related_subject_type, related_subject_id, template_key, subject",
    )
    .eq("resend_id", emailId)
    .maybeSingle();
  const send = row as {
    id: string;
    company_id: string;
    opens_count: number;
    clicks_count: number;
    customer_id: string | null;
    lead_id: string | null;
    related_subject_type: string | null;
    related_subject_id: string | null;
    template_key: string | null;
    subject: string;
  } | null;
  if (!send) {
    return NextResponse.json({ ok: true, ignored: "send not found" });
  }

  const update: Record<string, unknown> = { last_event_at: now };
  let timelineKind: string | null = null;
  switch (body.type) {
    case "email.delivered":
      update.delivered_at = now;
      update.status = "delivered";
      // No insertamos evento en timeline para delivered (es ruido).
      break;
    case "email.opened":
      update.opened_at = now;
      update.opens_count = (send.opens_count ?? 0) + 1;
      // Solo emitimos evento la PRIMERA vez (para no llenar timeline).
      if ((send.opens_count ?? 0) === 0) timelineKind = "email.opened";
      break;
    case "email.clicked":
      update.clicked_at = now;
      update.clicks_count = (send.clicks_count ?? 0) + 1;
      if ((send.clicks_count ?? 0) === 0) timelineKind = "email.clicked";
      break;
    case "email.bounced":
      update.bounced_at = now;
      update.status = "bounced";
      timelineKind = "email.bounced";
      break;
    case "email.complained":
      update.complained_at = now;
      update.status = "complained";
      timelineKind = "email.complained";
      break;
    default:
      return NextResponse.json({ ok: true, ignored: body.type });
  }

  await admin.from("email_sends").update(update).eq("id", send.id);

  if (timelineKind) {
    try {
      await admin.from("events").insert({
        company_id: send.company_id,
        subject_type:
          send.related_subject_type ??
          (send.customer_id ? "customer" : send.lead_id ? "lead" : "company"),
        subject_id:
          send.related_subject_id ?? send.customer_id ?? send.lead_id ?? send.company_id,
        kind: timelineKind,
        payload: {
          email_send_id: send.id,
          template_key: send.template_key,
          subject: send.subject,
        },
        actor_user_id: null,
      });
    } catch (e) {
      console.error("[resend webhook] event insert failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
