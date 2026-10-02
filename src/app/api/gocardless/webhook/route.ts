/**
 * Webhook GoCardless — sincroniza estados de mandato y pago.
 *
 * GoCardless firma cada webhook con HMAC-SHA256 sobre el body usando el
 * webhook_secret configurado al crear el endpoint. Header:
 *   Webhook-Signature: <hex>
 *
 * Como el secret es por empresa, la URL del webhook lleva el company_id
 * en query string: /api/gocardless/webhook?company_id=...
 *
 * Eventos relevantes que procesamos:
 *   mandates.active            → mandate.status = active
 *   mandates.cancelled         → mandate.status = cancelled
 *   mandates.failed            → mandate.status = failed
 *   payments.confirmed         → payment.status = confirmed + wallet → collected + cobro en su factura
 *   payments.paid_out          → payment.status = paid_out + wallet → validated
 *   payments.failed            → payment.status = failed + wallet → rejected
 *   payments.cancelled         → payment.status = cancelled + wallet → rejected
 *   payments.charged_back      → payment.status = charged_back + wallet → rejected + se deshace el cobro
 *
 * La lógica vive en src/modules/gocardless/webhook-proceso.ts (máquina de
 * estados: un evento tardío no hace retroceder un pago).
 */
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyWebhookSignature } from "@/modules/gocardless/client";
import { procesarEventoGc, type GcEvent } from "@/modules/gocardless/webhook-proceso";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id required" }, { status: 400 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get("webhook-signature") ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: settings } = await admin
    .from("gocardless_settings")
    .select("webhook_secret")
    .eq("company_id", companyId)
    .maybeSingle();
  const secret = (settings as { webhook_secret: string | null } | null)?.webhook_secret;
  if (!secret) {
    return NextResponse.json({ error: "no webhook secret" }, { status: 401 });
  }
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { events?: GcEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // I24: si algún evento falla se responde 500 para que GoCardless lo
  // reintente. Antes se respondía 200 siempre y, además, el reintento chocaba
  // con el índice único del evento y se descartaba: el evento se perdía.
  let fallos = 0;
  for (const ev of payload.events ?? []) {
    const { error: insertErr } = await admin.from("gocardless_webhook_events").insert({
      company_id: companyId,
      gocardless_event_id: ev.id,
      resource_type: ev.resource_type,
      action: ev.action,
      payload: ev,
    });
    if (insertErr) {
      const duplicado =
        insertErr.code === "23505" || /duplicate/i.test(insertErr.message ?? "");
      if (!duplicado) {
        fallos++;
        continue;
      }
      // Ya lo teníamos: solo se reprocesa si quedó sin procesar.
      const { data: prev } = await admin
        .from("gocardless_webhook_events")
        .select("processed_at")
        .eq("gocardless_event_id", ev.id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!prev || (prev as { processed_at: string | null }).processed_at) continue;
    }

    try {
      await procesarEventoGc(admin, companyId, ev);
      await admin
        .from("gocardless_webhook_events")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("gocardless_event_id", ev.id)
        .eq("company_id", companyId);
    } catch (e) {
      fallos++;
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("gocardless_webhook_events")
        .update({ error: msg })
        .eq("gocardless_event_id", ev.id)
        .eq("company_id", companyId);
    }
  }
  if (fallos > 0) {
    return NextResponse.json({ ok: false, failed: fallos }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
