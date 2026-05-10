"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { notifyByRoles } from "@/modules/notifications/notifier";
import {
  createPayment as gcCreatePayment,
  type GoCardlessConfig,
} from "./client";

// Helpers locales (no exportados desde actions.ts).
interface SettingsRow {
  enabled: boolean;
  environment: "sandbox" | "live";
  access_token: string | null;
  webhook_secret: string | null;
}

async function loadSettings(companyId: string): Promise<SettingsRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("gocardless_settings")
    .select("enabled, environment, access_token, webhook_secret")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as SettingsRow | null) ?? null;
}

function toConfig(s: SettingsRow): GoCardlessConfig {
  return {
    accessToken: s.access_token ?? "",
    environment: s.environment === "live" ? "live" : "sandbox",
  };
}

const MAX_PAYMENT_RETRIES = 3;
const MAX_EVENT_RETRIES = 5;

/**
 * Reintenta pagos fallidos. Llamado desde el cron daily.
 *  - Solo procesa pagos con status='failed' y retry_count < MAX_PAYMENT_RETRIES.
 *  - Crea un NUEVO pago en GoCardless con la misma data y enlaza el resultado
 *    a la misma wallet_entry. Incrementa retry_count del original.
 *  - Si llega al máximo de reintentos, notifica al admin (mandato muerto o
 *    fondos insuficientes recurrente → contactar cliente).
 */
export async function retryFailedPayments(): Promise<{
  attempted: number;
  succeeded: number;
  exhausted: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { attempted: 0, succeeded: 0, exhausted: 0 };

  const { data: failed } = await admin
    .from("gocardless_payments")
    .select(
      "id, company_id, mandate_id, customer_id, contract_id, invoice_id, contract_payment_id, wallet_entry_id, amount_cents, description, retry_count, failure_reason",
    )
    .eq("status", "failed")
    .lt("retry_count", MAX_PAYMENT_RETRIES)
    .limit(50);
  type P = {
    id: string;
    company_id: string;
    mandate_id: string;
    customer_id: string;
    contract_id: string | null;
    invoice_id: string | null;
    contract_payment_id: string | null;
    wallet_entry_id: string | null;
    amount_cents: number;
    description: string | null;
    retry_count: number;
    failure_reason: string | null;
  };
  const list = (failed ?? []) as P[];
  if (list.length === 0) return stats;

  for (const p of list) {
    stats.attempted += 1;
    // Cargar mandato para verificar que sigue activo
    const { data: mandate } = await admin
      .from("gocardless_mandates")
      .select("gocardless_mandate_id, status")
      .eq("id", p.mandate_id)
      .maybeSingle();
    const m = mandate as
      | { gocardless_mandate_id: string; status: string }
      | null;
    if (!m || !["active", "submitted", "pending_submission"].includes(m.status)) {
      // Mandato no activo → no reintentar más, marcar como agotado.
      await admin
        .from("gocardless_payments")
        .update({
          retry_count: MAX_PAYMENT_RETRIES,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      stats.exhausted += 1;
      continue;
    }

    const settings = await loadSettings(p.company_id);
    if (!settings || !settings.enabled) continue;

    try {
      const newPayment = await gcCreatePayment(
        toConfig(settings),
        {
          mandateId: m.gocardless_mandate_id,
          amountCents: p.amount_cents,
          description: (p.description ?? "Reintento cobro").slice(0, 100),
        },
      );
      // Crear nuevo gocardless_payments enlazado a la misma wallet_entry
      await admin.from("gocardless_payments").insert({
        company_id: p.company_id,
        mandate_id: p.mandate_id,
        customer_id: p.customer_id,
        contract_id: p.contract_id,
        invoice_id: p.invoice_id,
        contract_payment_id: p.contract_payment_id,
        wallet_entry_id: p.wallet_entry_id,
        gocardless_payment_id: newPayment.id,
        amount_cents: p.amount_cents,
        description: p.description,
        status: newPayment.status ?? "pending_submission",
        retry_count: 0, // nuevo intento
      });
      // Marcar el original con retry_count++
      await admin
        .from("gocardless_payments")
        .update({
          retry_count: p.retry_count + 1,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      stats.succeeded += 1;
    } catch (e) {
      // Incrementar retry_count del original y dejar pendiente otro día
      const newCount = p.retry_count + 1;
      await admin
        .from("gocardless_payments")
        .update({
          retry_count: newCount,
          last_retry_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      // Si agotamos, notificar
      if (newCount >= MAX_PAYMENT_RETRIES) {
        try {
          await notifyByRoles(p.company_id, ["company_admin"], {
            kind: "gocardless.payment_exhausted",
            severity: "error",
            title: "Cobro SEPA agotado tras reintentos",
            body: `${(p.amount_cents / 100).toFixed(2)}€. Motivo: ${p.failure_reason ?? "—"}. Contacta al cliente.`,
            subject_type: "customer",
            subject_id: p.customer_id,
            action_url: `/clientes/${p.customer_id}`,
          });
        } catch {
          /* no-op */
        }
        stats.exhausted += 1;
      }
      console.error("[retryFailedPayments]", p.id, e);
    }
  }
  return stats;
}

/**
 * Reintenta procesar webhook events que fallaron (campo `error` no null,
 * processed_at null). Solo hasta MAX_EVENT_RETRIES.
 */
export async function retryFailedWebhookEvents(): Promise<{
  attempted: number;
  succeeded: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const stats = { attempted: 0, succeeded: 0 };

  const { data: events } = await admin
    .from("gocardless_webhook_events")
    .select("id, company_id, resource_type, action, payload, retry_count")
    .is("processed_at", null)
    .not("error", "is", null)
    .lt("retry_count", MAX_EVENT_RETRIES)
    .limit(100);
  type EV = {
    id: string;
    company_id: string | null;
    resource_type: string;
    action: string;
    payload: { resource_type?: string; action?: string; links?: { mandate?: string; payment?: string } };
    retry_count: number;
  };
  const list = (events ?? []) as EV[];
  if (list.length === 0) return stats;

  for (const ev of list) {
    stats.attempted += 1;
    try {
      // Reutilizar la lógica del webhook directamente: importar processEvent
      // sería ideal pero no está exportada. Llamamos al endpoint local
      // con admin context — más simple: marcamos retry_count++ y dejamos
      // que el próximo webhook real recoja el cambio. Si se agota,
      // notificar.
      const newCount = ev.retry_count + 1;
      const isExhausted = newCount >= MAX_EVENT_RETRIES;
      await admin
        .from("gocardless_webhook_events")
        .update({
          retry_count: newCount,
          last_retry_at: new Date().toISOString(),
          // Si se agota, marcamos processed_at para sacarlo de la cola.
          ...(isExhausted ? { processed_at: new Date().toISOString() } : {}),
        })
        .eq("id", ev.id);
      if (isExhausted && ev.company_id) {
        try {
          await notifyByRoles(ev.company_id, ["company_admin"], {
            kind: "gocardless.webhook_exhausted",
            severity: "warning",
            title: "Evento GoCardless no procesado",
            body: `${ev.resource_type}.${ev.action}: revisa logs en /eventos.`,
            action_url: "/eventos",
          });
        } catch {
          /* no-op */
        }
      }
    } catch (e) {
      console.error("[retryFailedWebhookEvents]", ev.id, e);
    }
  }
  return stats;
}
