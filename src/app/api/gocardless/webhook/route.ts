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
 *   payments.confirmed         → payment.status = confirmed + wallet → collected
 *   payments.paid_out          → payment.status = paid_out + wallet → validated
 *   payments.failed            → payment.status = failed + wallet → rejected
 *   payments.cancelled         → payment.status = cancelled + wallet → cancelled
 *   payments.charged_back      → payment.status = charged_back + wallet → rejected
 */
import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyWebhookSignature } from "@/modules/gocardless/client";

export const dynamic = "force-dynamic";

interface GcEvent {
  id: string;
  resource_type: string;
  action: string;
  links?: { mandate?: string; payment?: string };
  created_at: string;
}

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

  for (const ev of payload.events ?? []) {
    // Idempotencia
    const { error: insertErr } = await admin.from("gocardless_webhook_events").insert({
      company_id: companyId,
      gocardless_event_id: ev.id,
      resource_type: ev.resource_type,
      action: ev.action,
      payload: ev,
    });
    if (insertErr && !insertErr.message?.includes("duplicate")) {
      // Otro tipo de error — no procesamos pero seguimos con los siguientes
      continue;
    }
    if (insertErr) continue; // ya procesado

    try {
      await processEvent(admin, companyId, ev);
      await admin
        .from("gocardless_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("gocardless_event_id", ev.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("gocardless_webhook_events")
        .update({ error: msg })
        .eq("gocardless_event_id", ev.id);
    }
  }
  return NextResponse.json({ ok: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processEvent(admin: any, companyId: string, ev: GcEvent) {
  if (ev.resource_type === "mandates" && ev.links?.mandate) {
    const mandateStatus = mapMandateAction(ev.action);
    if (mandateStatus) {
      // Cargar mandato actual para sacar customer_id antes del update
      const { data: prevMandate } = await admin
        .from("gocardless_mandates")
        .select("id, customer_id, status")
        .eq("gocardless_mandate_id", ev.links.mandate)
        .eq("company_id", companyId)
        .maybeSingle();
      const pm = prevMandate as
        | { id: string; customer_id: string | null; status: string }
        | null;

      await admin
        .from("gocardless_mandates")
        .update({
          status: mandateStatus,
          ...(mandateStatus === "cancelled" ? { cancelled_at: new Date().toISOString() } : {}),
        })
        .eq("gocardless_mandate_id", ev.links.mandate)
        .eq("company_id", companyId);

      // Notificar a admin si el mandato pasó a cancelled/failed/expired —
      // estados terminales en los que el cliente ya no podrá ser cobrado
      // por SEPA. El admin debe contactar para regularizar.
      if (
        pm &&
        pm.status !== mandateStatus &&
        ["cancelled", "failed", "expired"].includes(mandateStatus)
      ) {
        try {
          let customerName = "cliente";
          if (pm.customer_id) {
            const { data: c } = await admin
              .from("customers")
              .select(
                "party_kind, legal_name, trade_name, first_name, last_name",
              )
              .eq("id", pm.customer_id)
              .maybeSingle();
            const cu = c as
              | {
                  party_kind: "individual" | "company";
                  legal_name: string | null;
                  trade_name: string | null;
                  first_name: string | null;
                  last_name: string | null;
                }
              | null;
            if (cu) {
              customerName =
                cu.party_kind === "company"
                  ? cu.trade_name || cu.legal_name || "cliente"
                  : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() ||
                    "cliente";
            }
          }
          const { notifyByRoles } = await import(
            "@/modules/notifications/notifier"
          );
          await notifyByRoles(companyId, ["company_admin"], {
            kind: "gocardless.mandate_lost",
            severity: "error",
            title: `Mandato SEPA ${mandateStatus}`,
            body: `El mandato de domiciliación de ${customerName} ha pasado a ${mandateStatus}. Contacta para reactivar.`,
            subject_type: "customer",
            subject_id: pm.customer_id ?? undefined,
            action_url: pm.customer_id ? `/clientes/${pm.customer_id}` : "/clientes",
          });
        } catch (e) {
          console.error("[gocardless webhook] notify mandate lost:", e);
        }
      }
    }
  }
  if (ev.resource_type === "payments" && ev.links?.payment) {
    const paymentStatus = mapPaymentAction(ev.action);
    const walletStatus = mapPaymentToWallet(ev.action);
    if (paymentStatus) {
      const { data: pay } = await admin
        .from("gocardless_payments")
        .select("id, wallet_entry_id, contract_payment_id")
        .eq("gocardless_payment_id", ev.links.payment)
        .eq("company_id", companyId)
        .maybeSingle();
      const p = pay as
        | { id: string; wallet_entry_id: string | null; contract_payment_id: string | null }
        | null;
      if (p) {
        await admin
          .from("gocardless_payments")
          .update({
            status: paymentStatus,
            ...(paymentStatus === "paid_out" ? { paid_out_at: new Date().toISOString() } : {}),
          })
          .eq("id", p.id);
        if (walletStatus && p.wallet_entry_id) {
          const updates: Record<string, unknown> = { status: walletStatus };
          if (walletStatus === "validated") updates.validated_at = new Date().toISOString();
          await admin.from("wallet_entries").update(updates).eq("id", p.wallet_entry_id);
        }
        if (paymentStatus === "confirmed" && p.contract_payment_id) {
          await admin
            .from("contract_payments")
            .update({
              status: "collected_pending_validation",
              collected_at: new Date().toISOString(),
            })
            .eq("id", p.contract_payment_id);
        }
      }
    }
  }
}

function mapMandateAction(action: string): string | null {
  switch (action) {
    case "submitted":
      return "submitted";
    case "active":
      return "active";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return null;
  }
}

function mapPaymentAction(action: string): string | null {
  switch (action) {
    case "submitted":
      return "submitted";
    case "confirmed":
      return "confirmed";
    case "paid_out":
      return "paid_out";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "charged_back":
      return "charged_back";
    default:
      return null;
  }
}

function mapPaymentToWallet(action: string): string | null {
  switch (action) {
    case "confirmed":
      return "collected";
    case "paid_out":
      return "validated";
    case "failed":
    case "charged_back":
      return "rejected";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}
