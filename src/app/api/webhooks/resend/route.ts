import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import {
  calcularCambiosEvento,
  cambiosParaOutbox,
  verificarFirmaSvix,
  type EventoResend,
} from "@/modules/mailing/webhook-resend";

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
 *  - email.failed        → status='failed' + motivo
 *  - email.received      → correo entrante: se acepta y se ignora
 *
 * Casa el evento por `resend_id` en email_sends y en email_outbox. La lógica
 * de cada evento está en src/modules/mailing/webhook-resend.ts (con tests).
 *
 * Configuración: en Resend Dashboard → Webhooks → URL apuntando aquí.
 * Verifica firma con secret RESEND_WEBHOOK_SECRET (Svix-Signature).
 */
export async function POST(req: NextRequest) {
  // Leemos el body como texto raw ANTES de parsearlo — necesario para
  // verificar HMAC sobre los bytes exactos enviados por Resend.
  const rawBody = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // SEGURIDAD (fail-closed): sin secret no se acepta el webhook. Antes
  // hacía fail-open: si la variable se perdía cualquiera podía marcar
  // emails como bounced/complained y cortar comunicaciones comerciales.
  if (!secret) {
    return NextResponse.json(
      { error: "webhook secret not configured" },
      { status: 500 },
    );
  }
  const svixId = req.headers.get("svix-id");
  const svixTs = req.headers.get("svix-timestamp");
  const svixSig = req.headers.get("svix-signature");
  if (!svixId || !svixTs || !svixSig) {
    return NextResponse.json(
      { error: "missing svix headers" },
      { status: 401 },
    );
  }
  // Firma Svix + anti-replay (timestamp dentro de 5 min).
  const firma = verificarFirmaSvix({
    cuerpo: rawBody,
    svixId,
    svixTimestamp: svixTs,
    svixSignature: svixSig,
    secreto: secret,
  });
  if (!firma.ok) {
    return NextResponse.json({ error: firma.motivo }, { status: 401 });
  }

  let body: EventoResend;
  try {
    body = JSON.parse(rawBody) as EventoResend;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // email.received = correo ENTRANTE (recepción de Resend). No corresponde a
  // ningún envío nuestro: se acepta (200) para que Resend no lo reintente.
  if (body.type === "email.received") {
    console.info("[resend webhook] correo entrante recibido:", body.data?.email_id ?? "sin id");
    return NextResponse.json({ ok: true, ignored: "email.received (entrante)" });
  }

  const emailId = body.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true, ignored: "no email_id" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: row, error: selErr } = await admin
    .from("email_sends")
    .select(
      "id, company_id, status, opens_count, clicks_count, customer_id, lead_id, related_subject_type, related_subject_id, template_key, subject",
    )
    .eq("resend_id", emailId)
    .maybeSingle();
  if (selErr) {
    // 500 → Resend reintenta más tarde en vez de perder el evento.
    console.error("[resend webhook] select email_sends:", selErr.message);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
  const send = row as {
    id: string;
    company_id: string;
    status: string | null;
    opens_count: number;
    clicks_count: number;
    customer_id: string | null;
    lead_id: string | null;
    related_subject_type: string | null;
    related_subject_id: string | null;
    template_key: string | null;
    subject: string;
  } | null;

  // El mismo envío también vive en email_outbox (lo escribe sendViaSmtp).
  const { data: outbox } = await admin
    .from("email_outbox")
    .select("id, opens_count, clicks_count")
    .eq("resend_id", emailId)
    .maybeSingle();

  if (!send && !outbox) {
    // Normal con correos de otros proyectos de la misma cuenta de Resend.
    return NextResponse.json({ ok: true, ignored: "send not found" });
  }

  let timelineKind: string | null = null;
  const actualizados: string[] = [];

  if (send) {
    const r = calcularCambiosEvento(body, send);
    if (r.ignorar) return NextResponse.json({ ok: true, ignored: r.motivo });
    timelineKind = r.eventoTimeline;
    const { error: upErr } = await admin.from("email_sends").update(r.cambios).eq("id", send.id);
    if (upErr) {
      console.error("[resend webhook] update email_sends:", upErr.message);
      return NextResponse.json({ error: "db error" }, { status: 500 });
    }
    actualizados.push("email_sends");
  }

  if (outbox) {
    const r = calcularCambiosEvento(body, { status: "sent", ...outbox });
    if (r.ignorar) {
      if (!send) return NextResponse.json({ ok: true, ignored: r.motivo });
    } else {
      const { error: upErr } = await admin
        .from("email_outbox")
        .update(cambiosParaOutbox(body, r.cambios))
        .eq("id", outbox.id);
      if (upErr) console.error("[resend webhook] update email_outbox:", upErr.message);
      else actualizados.push("email_outbox");
    }
  }

  if (send && timelineKind) {
    const { error: evErr } = await admin.from("events").insert({
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
    if (evErr) console.error("[resend webhook] event insert failed:", evErr.message);
  }

  return NextResponse.json({ ok: true, updated: actualizados });
}
