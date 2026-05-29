"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { decryptString } from "@/shared/lib/crypto/aes-gcm";
import type { ProviderId, ProviderCredentials, PushInvoiceInput } from "./types";
import { getProviderClient } from "./registry";

/**
 * Empuja una factura al proveedor externo configurado de la empresa
 * (Verifacti, Invopop, Holded…). Pensado para el botón "Enviar a [proveedor]"
 * en la ficha de factura.
 *
 * Flujo:
 *  1. Lee company_settings.external_invoicing_provider + credenciales cifradas.
 *  2. Si provider='none' o falta config → error friendly.
 *  3. Lee la factura + customer_snapshot + líneas + totales.
 *  4. Llama client.pushInvoice(creds, input).
 *  5. Persiste el resultado en external_invoicing_submissions.
 *  6. Si el proveedor devuelve external_id, lo guarda en invoices.external_id
 *     (best-effort si la columna no existe; ver migración).
 *
 * Devuelve {ok,error} o {ok,external_id,external_url}.
 */
export async function pushInvoiceToExternalProviderAction(
  invoiceId: string,
): Promise<
  | { ok: true; external_id?: string; external_url?: string; aeat_csv?: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Sin permisos" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1. Config del proveedor
    const { data: cs } = await admin
      .from("company_settings")
      .select(
        `external_invoicing_provider, external_invoicing_environment,
         external_invoicing_api_key_encrypted, external_invoicing_extra_encrypted,
         external_invoicing_last_test_ok`,
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const row = cs as Record<string, unknown> | null;
    const provider = ((row?.external_invoicing_provider as ProviderId) ?? "none") as ProviderId;
    if (provider === "none") {
      return {
        ok: false,
        error:
          "No hay proveedor externo configurado. Elige uno en /configuracion/facturacion.",
      };
    }
    const apiKeyEnc = row?.external_invoicing_api_key_encrypted as string | null;
    if (!apiKeyEnc) {
      return {
        ok: false,
        error: "Falta API key del proveedor. Configúrala en /configuracion/facturacion.",
      };
    }
    if (row?.external_invoicing_last_test_ok === false) {
      return {
        ok: false,
        error:
          "La última prueba de conexión con el proveedor falló. Vuelve a probar antes de enviar facturas.",
      };
    }

    const extraEnc = row?.external_invoicing_extra_encrypted as string | null;
    const creds: ProviderCredentials = {
      api_key: decryptString(apiKeyEnc),
      environment:
        ((row?.external_invoicing_environment as
          | "sandbox"
          | "production"
          | null) ?? "sandbox") as "sandbox" | "production",
      extra: extraEnc
        ? (JSON.parse(decryptString(extraEnc)) as Record<string, string>)
        : undefined,
    };

    // 2. Cargar factura (defensiva: el campo nombre puede venir de
    //    customer_snapshot V2 o customer_fiscal_snapshot legacy)
    const { data: inv } = await admin
      .from("invoices")
      .select(
        `id, company_id, status, full_reference, reference_code,
         issue_date, issued_at, due_date, due_at,
         subtotal_cents, tax_cents, tax_total_cents, total_cents,
         customer_fiscal_snapshot, customer_snapshot, notes`,
      )
      .eq("id", invoiceId)
      .single();
    if (!inv) return { ok: false, error: "Factura no encontrada" };
    if (inv.company_id !== session.company_id) {
      return { ok: false, error: "Factura de otra empresa" };
    }
    const snap =
      (inv.customer_snapshot as Record<string, unknown> | null) ??
      (inv.customer_fiscal_snapshot as Record<string, unknown> | null) ??
      {};
    const addr = (snap.address ?? {}) as Record<string, unknown>;

    const { data: lines } = await admin
      .from("invoice_lines")
      .select("description, quantity, unit_price_cents, tax_rate")
      .eq("invoice_id", invoiceId)
      .order("display_order");

    const input: PushInvoiceInput = {
      invoice_id: invoiceId,
      company_id: session.company_id,
      reference_code: (inv.reference_code as string | null) ?? null,
      full_reference: (inv.full_reference as string | null) ?? null,
      issued_at: (inv.issued_at as string | null) ?? (inv.issue_date as string),
      due_at: (inv.due_at as string | null) ?? (inv.due_date as string | null),
      customer: {
        name:
          (snap.trade_name as string) ||
          (snap.legal_name as string) ||
          `${snap.first_name ?? ""} ${snap.last_name ?? ""}`.trim() ||
          "Cliente",
        tax_id: (snap.tax_id as string | null) ?? null,
        email: (snap.email as string | null) ?? null,
        address:
          (addr.street as string | null) ?? (snap.address as string | null) ?? null,
        postal_code: (addr.postal_code as string | null) ?? null,
        city: (addr.city as string | null) ?? null,
        province: (addr.province as string | null) ?? null,
        country: (addr.country as string | null) ?? "ES",
      },
      lines: ((lines ?? []) as Array<{
        description: string;
        quantity: number;
        unit_price_cents: number;
        tax_rate: number;
      }>).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        tax_rate: l.tax_rate,
      })),
      subtotal_cents: inv.subtotal_cents as number,
      tax_total_cents:
        (inv.tax_total_cents as number | null) ?? (inv.tax_cents as number),
      total_cents: inv.total_cents as number,
      notes: (inv.notes as string | null) ?? null,
    };

    // 3. Crear el registro de envío en 'sending' antes de llamar
    const { data: subRow } = await admin
      .from("external_invoicing_submissions")
      .insert({
        company_id: session.company_id,
        invoice_id: invoiceId,
        provider,
        status: "sending",
        attempt_number: 1,
        request_payload: input as unknown,
      })
      .select("id")
      .single();
    const submissionId = (subRow as { id: string } | null)?.id;

    // 4. Llamar al cliente
    const client = await getProviderClient(provider);
    const result = await client.pushInvoice(creds, input);

    // 5. Persistir resultado
    if (submissionId) {
      await admin
        .from("external_invoicing_submissions")
        .update({
          status: result.ok ? "sent" : "failed",
          sent_at: result.ok ? new Date().toISOString() : null,
          external_id: result.external_id ?? null,
          external_url: result.external_url ?? null,
          response_payload: result.raw_response ?? null,
          error_code: result.ok ? null : result.error_code ?? null,
          error_message: result.ok ? null : result.error_message ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", submissionId);
    }

    revalidatePath(`/facturas/${invoiceId}`);
    if (result.ok) {
      return {
        ok: true,
        external_id: result.external_id,
        external_url: result.external_url,
        aeat_csv: result.aeat_csv,
      };
    }
    return {
      ok: false,
      error:
        result.error_message ??
        result.error_code ??
        "El proveedor rechazó la factura",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Lista los envíos al proveedor externo para una factura concreta (para
 * pintar el historial en la ficha).
 */
export async function listExternalSubmissionsForInvoiceAction(
  invoiceId: string,
): Promise<
  Array<{
    id: string;
    provider: string;
    status: string;
    sent_at: string | null;
    external_id: string | null;
    external_url: string | null;
    error_message: string | null;
    created_at: string;
  }>
> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("external_invoicing_submissions")
    .select(
      "id, provider, status, sent_at, external_id, external_url, error_message, created_at",
    )
    .eq("company_id", session.company_id)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{
    id: string;
    provider: string;
    status: string;
    sent_at: string | null;
    external_id: string | null;
    external_url: string | null;
    error_message: string | null;
    created_at: string;
  }>;
}
