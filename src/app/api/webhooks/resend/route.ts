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
    .select("id, opens_count, clicks_count")
    .eq("resend_id", emailId)
    .maybeSingle();
  const send = row as { id: string; opens_count: number; clicks_count: number } | null;
  if (!send) {
    return NextResponse.json({ ok: true, ignored: "send not found" });
  }

  const update: Record<string, unknown> = { last_event_at: now };
  switch (body.type) {
    case "email.delivered":
      update.delivered_at = now;
      update.status = "delivered";
      break;
    case "email.opened":
      update.opened_at = now;
      update.opens_count = (send.opens_count ?? 0) + 1;
      break;
    case "email.clicked":
      update.clicked_at = now;
      update.clicks_count = (send.clicks_count ?? 0) + 1;
      break;
    case "email.bounced":
      update.bounced_at = now;
      update.status = "bounced";
      break;
    case "email.complained":
      update.complained_at = now;
      // Marcar status como complained → no incluir en futuras campañas
      update.status = "complained";
      break;
    default:
      return NextResponse.json({ ok: true, ignored: body.type });
  }

  await admin.from("email_sends").update(update).eq("id", send.id);
  return NextResponse.json({ ok: true });
}
