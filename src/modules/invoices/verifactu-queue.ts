/**
 * Procesador de la cola Verifactu (envíos AEAT pendientes).
 * Extraído del endpoint del cron para poder llamarlo desde:
 *  · Cron diario (`/api/cron/daily`) — Vercel Hobby
 *  · Cron dedicado (`/api/cron/verifactu-send`) — cada 15min Vercel Pro
 *  · Endpoint manual (sin cron) si el admin quiere forzar
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { sendToAeat } from "./verifactu-aeat";
import { buildRegistroFacturacionAltaXml, buildSoapEnvelope } from "./verifactu-xml";

const MAX_ATTEMPTS_PER_RUN = 50;
const MAX_RETRIES = 5;

export interface QueueResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Procesa hasta 50 envíos pendientes con backoff exponencial:
 * 1ª inmediato, 2ª +5min, 3ª +30min, 4ª +2h, 5ª +12h.
 * Tras 5 intentos fallidos marca como "failed" definitivamente.
 *
 * GATE XADES: AEAT rechaza envíos SIN firma XAdES-BES con el cert FNMT
 * de la empresa. Esa firma criptográfica (RSA-SHA256 sobre canonicalización
 * XML C14N + propiedades XAdES-BES) NO está implementada todavía — ver
 * project_xades_state.md para el plan. Mientras tanto este gate evita
 * intentar el envío (que solo agotaría reintentos y ensuciaría los logs).
 * Para activarlo: VERIFACTU_XADES_ENABLED=true en Vercel.
 */
export async function processVerifactuQueue(): Promise<QueueResult> {
  if (process.env.VERIFACTU_XADES_ENABLED !== "true") {
    // Las submissions quedan en 'pending' tal cual; cuando se active la
    // firma XAdES y se ponga el flag, el siguiente tick las procesará.
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: pending } = await admin
    .from("invoice_aeat_submissions")
    .select("id, company_id, record_id, attempt_number, created_at")
    .eq("status", "pending")
    .lte("attempt_number", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(MAX_ATTEMPTS_PER_RUN);

  type Submission = {
    id: string;
    company_id: string;
    record_id: string;
    attempt_number: number;
    created_at: string;
  };
  const submissions = (pending ?? []) as Submission[];

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const sub of submissions) {
    const delays = [0, 5, 30, 120, 720]; // minutos por intento
    const minWaitMinutes = delays[sub.attempt_number - 1] ?? 720;
    const ageMinutes =
      (Date.now() - new Date(sub.created_at).getTime()) / 60000;
    if (ageMinutes < minWaitMinutes) continue;

    processed++;

    try {
      const { data: rec } = await admin
        .from("invoice_verifactu_records")
        .select(
          `id, invoice_id, record_type, issuer_nif, issuer_name,
           series_code, invoice_number, invoice_type, issued_at,
           operation_date, recipient_nif, recipient_name,
           base_total_cents, tax_total_cents, total_cents,
           prev_hash, current_hash`,
        )
        .eq("id", sub.record_id)
        .single();
      if (!rec) {
        await markFailed(admin, sub.id, "RECORD_NOT_FOUND", "Registro no encontrado");
        failed++;
        continue;
      }

      const { data: taxes } = await admin
        .from("invoice_taxes")
        .select("tax_rate, base_cents, tax_cents, is_exempt, exempt_reason")
        .eq("invoice_id", rec.invoice_id);

      const { data: invoice } = await admin
        .from("invoices")
        .select("description")
        .eq("id", rec.invoice_id)
        .maybeSingle();

      const { data: cs } = await admin
        .from("company_settings")
        .select(
          "verifactu_cert_encrypted, verifactu_cert_password_encrypted, verifactu_environment",
        )
        .eq("company_id", sub.company_id)
        .maybeSingle();
      if (!cs?.verifactu_cert_encrypted || !cs?.verifactu_cert_password_encrypted) {
        await markFailed(
          admin,
          sub.id,
          "CERT_MISSING",
          "Empresa sin certificado FNMT",
        );
        failed++;
        continue;
      }

      const registroXml = buildRegistroFacturacionAltaXml({
        id_version: "1.0",
        issuer_nif: rec.issuer_nif,
        issuer_name: rec.issuer_name,
        series_code: rec.series_code,
        invoice_number: rec.invoice_number,
        invoice_type: rec.invoice_type,
        issued_at: new Date(rec.issued_at),
        operation_date: new Date(rec.operation_date),
        description: invoice?.description ?? "Factura",
        recipient_nif: rec.recipient_nif,
        recipient_name: rec.recipient_name,
        base_total_cents: rec.base_total_cents,
        tax_total_cents: rec.tax_total_cents,
        total_cents: rec.total_cents,
        taxes: ((taxes ?? []) as Array<{
          tax_rate: number;
          base_cents: number;
          tax_cents: number;
          is_exempt: boolean;
          exempt_reason: string | null;
        }>).map((t) => ({
          tax_rate: t.tax_rate,
          base_cents: t.base_cents,
          tax_cents: t.tax_cents,
          is_exempt: t.is_exempt,
          exempt_reason: t.exempt_reason ?? undefined,
        })),
        prev_hash: rec.prev_hash,
        current_hash: rec.current_hash,
      });
      const envelope = buildSoapEnvelope(registroXml)
        .replace("EMPRESA", rec.issuer_name)
        .replace("NIF_PLACEHOLDER", rec.issuer_nif);

      await admin
        .from("invoice_aeat_submissions")
        .update({
          status: "sending",
          attempt_number: sub.attempt_number,
          sent_at: new Date().toISOString(),
          request_xml:
            envelope.length > 200000 ? envelope.slice(0, 200000) : envelope,
        })
        .eq("id", sub.id);

      const result = await sendToAeat({
        soapEnvelope: envelope,
        encryptedCert: Buffer.from(cs.verifactu_cert_encrypted),
        encryptedPassword: cs.verifactu_cert_password_encrypted,
        environment: cs.verifactu_environment ?? "production",
      });

      if (result.ok) {
        await admin
          .from("invoice_aeat_submissions")
          .update({
            status: "success",
            response_xml: result.raw_response.slice(0, 200000),
            responded_at: new Date().toISOString(),
          })
          .eq("id", sub.id);

        await admin
          .from("invoice_verifactu_records")
          .update({
            sent_to_aeat: true,
            sent_at: new Date().toISOString(),
            aeat_response_status: result.status,
            aeat_csv: result.csv,
            aeat_response_payload: { raw: result.raw_response.slice(0, 50000) },
          })
          .eq("id", sub.record_id);

        await admin
          .from("invoices")
          .update({
            status: "accepted_aeat",
            verifactu_csv: result.csv,
            verifactu_submitted_at: new Date().toISOString(),
          })
          .eq("id", rec.invoice_id);

        await admin.from("invoice_verifactu_events").insert({
          company_id: sub.company_id,
          event_type: "aeat_response",
          severity: "info",
          payload: {
            record_id: sub.record_id,
            csv: result.csv,
            status: result.status,
          },
        });

        succeeded++;
      } else {
        const isFinal = sub.attempt_number >= MAX_RETRIES;
        await admin
          .from("invoice_aeat_submissions")
          .update({
            status: isFinal ? "failed" : "pending",
            attempt_number: sub.attempt_number + 1,
            error_code: result.error_code,
            error_message: result.error_message,
            response_xml: result.raw_response.slice(0, 200000),
            responded_at: new Date().toISOString(),
          })
          .eq("id", sub.id);

        if (isFinal) {
          await admin
            .from("invoice_verifactu_records")
            .update({
              aeat_response_status: result.status,
              aeat_error_code: result.error_code,
              aeat_error_message: result.error_message,
            })
            .eq("id", sub.record_id);

          await admin
            .from("invoices")
            .update({ status: "rejected_aeat" })
            .eq("id", rec.invoice_id);

          await admin.from("invoice_verifactu_events").insert({
            company_id: sub.company_id,
            event_type: "aeat_response",
            severity: "error",
            payload: {
              record_id: sub.record_id,
              error_code: result.error_code,
              error_message: result.error_message,
            },
          });
          failed++;
        }
      }
    } catch (e) {
      console.error("[verifactu-queue] error:", e);
      await markFailed(
        admin,
        sub.id,
        "EXCEPTION",
        e instanceof Error ? e.message : String(e),
      );
      failed++;
    }
  }

  return { processed, succeeded, failed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFailed(admin: any, id: string, code: string, msg: string) {
  await admin
    .from("invoice_aeat_submissions")
    .update({
      status: "failed",
      error_code: code,
      error_message: msg,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id);
}
