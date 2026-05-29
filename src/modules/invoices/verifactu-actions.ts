"use server";

/**
 * Server actions del nuevo módulo Verifactu (RD 1007/2023).
 * Convive con el actions.ts antiguo (sistema invoice_lines original).
 * Las nuevas tablas y flujo viven en migración 20260507200000.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { computeVerifactuHash, buildVerifactuQrUrl } from "./verifactu";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede gestionar facturas");
  }
  return session;
}

/** Versión que devuelve result en lugar de lanzar — para callables públicos. */
async function ensureAdminResult(): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>> }
  | { ok: false; error: string }
> {
  const session = await requireSession();
  if (session.is_superadmin) return { ok: true, session };
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  if (!session.roles.includes("company_admin")) {
    return {
      ok: false,
      error: "Solo el admin de empresa puede gestionar facturas",
    };
  }
  return { ok: true, session };
}

// ===========================================================================
// SERIES
// ===========================================================================

export interface InvoiceSeriesRow {
  id: string;
  code: string;
  name: string;
  prefix: string | null;
  invoice_type: string;
  next_number: number;
  year_reset: boolean;
  current_year: number;
  is_active: boolean;
  is_default: boolean;
}

export async function listInvoiceSeries(): Promise<InvoiceSeriesRow[]> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("invoice_series")
    .select(
      "id, series_code, description, prefix, invoice_type, next_number, resets_yearly, current_year, is_active, is_default, kind",
    )
    .eq("company_id", session.company_id)
    .order("is_default", { ascending: false })
    .order("series_code");
  // Mapear nombres antiguos → nuevos para que el front no cambie
  type Old = {
    id: string;
    series_code: string;
    description: string | null;
    prefix: string | null;
    invoice_type: string | null;
    next_number: number;
    resets_yearly: boolean | null;
    current_year: number | null;
    is_active: boolean;
    is_default: boolean | null;
    kind: string | null;
  };
  return ((data ?? []) as Old[]).map((s) => ({
    id: s.id,
    code: s.series_code,
    name: s.description ?? s.series_code,
    prefix: s.prefix,
    invoice_type: s.invoice_type ?? "F1",
    next_number: s.next_number,
    year_reset: s.resets_yearly ?? true,
    current_year: s.current_year ?? new Date().getFullYear(),
    is_active: s.is_active,
    is_default: s.is_default ?? false,
  }));
}

export async function upsertInvoiceSeriesAction(input: {
  id?: string;
  code: string;
  name: string;
  prefix?: string;
  invoice_type?: "F1" | "F2" | "F3";
  year_reset?: boolean;
  is_default?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await ensureAdminResult();
    if (!g.ok) return g;
    const { session } = g;
    if (!input.code.trim()) return { ok: false, error: "Código de serie obligatorio" };
    if (!input.name.trim()) return { ok: false, error: "Nombre obligatorio" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    if (input.is_default) {
      await admin
        .from("invoice_series")
        .update({ is_default: false })
        .eq("company_id", session.company_id)
        .neq("id", input.id ?? "00000000-0000-0000-0000-000000000000");
    }

    // Mapeo a nombres reales en BD (series_code, description, resets_yearly)
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      series_code: input.code.trim().toUpperCase(),
      description: input.name.trim(),
      prefix: input.prefix?.trim() || null,
      invoice_type: input.invoice_type ?? "F1",
      resets_yearly: input.year_reset ?? true,
      is_default: input.is_default ?? false,
      is_active: true,
      kind: "invoice", // requerido por el sistema antiguo
      current_year: new Date().getFullYear(),
    };

    if (input.id) {
      const { error } = await admin
        .from("invoice_series")
        .update(payload)
        .eq("id", input.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin.from("invoice_series").insert(payload);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath("/configuracion/facturacion");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

// ===========================================================================
// FACTURAS V2 (Verifactu)
// ===========================================================================

export interface InvoiceV2ListItem {
  id: string;
  reference_code: string | null;
  number: number | null;
  series_code: string | null;
  invoice_type: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  total_cents: number;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  has_qr: boolean;
}

export async function listInvoicesV2(filters?: {
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<InvoiceV2ListItem[]> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let query = admin
    .from("invoices")
    .select(
      `id, reference_code, number, invoice_type, status, customer_id,
       customer_snapshot, total_cents, issued_at, due_at, paid_at,
       verifactu_qr_url, series:invoice_series(series_code)`,
    )
    .eq("company_id", session.company_id)
    .is("deleted_at", null)
    .order("issued_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.fromDate) query = query.gte("issued_at", filters.fromDate);
  if (filters?.toDate) query = query.lte("issued_at", filters.toDate);
  const { data, error } = await query;
  if (error) throw error;
  type Row = {
    id: string;
    reference_code: string | null;
    number: number | null;
    invoice_type: string;
    status: string;
    customer_id: string | null;
    customer_snapshot: Record<string, unknown>;
    total_cents: number;
    issued_at: string | null;
    due_at: string | null;
    paid_at: string | null;
    verifactu_qr_url: string | null;
    series: { code: string } | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const cs = r.customer_snapshot as {
      legal_name?: string;
      trade_name?: string;
      first_name?: string;
      last_name?: string;
    };
    return {
      id: r.id,
      reference_code: r.reference_code,
      number: r.number,
      series_code: (r.series as { series_code?: string } | null)?.series_code ?? null,
      invoice_type: r.invoice_type,
      status: r.status,
      customer_id: r.customer_id,
      customer_name:
        cs?.trade_name ||
        cs?.legal_name ||
        `${cs?.first_name ?? ""} ${cs?.last_name ?? ""}`.trim() ||
        "—",
      total_cents: r.total_cents,
      issued_at: r.issued_at,
      due_at: r.due_at,
      paid_at: r.paid_at,
      has_qr: Boolean(r.verifactu_qr_url),
    };
  });
}

/** Crea factura BORRADOR a partir de un contrato. */
export async function createInvoiceFromContractV2Action(
  contractId: string,
  options?: { description?: string; due_days?: number },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const g = await ensureAdminResult();
    if (!g.ok) return g;
    const { session } = g;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: contract } = await admin
      .from("contracts")
      .select("id, customer_id, total_cash_cents, monthly_cents")
      .eq("id", contractId)
      .single();
    if (!contract) return { ok: false, error: "Contrato no encontrado" };

    const { data: customer } = await admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary")
      .eq("id", contract.customer_id)
      .single();
    if (!customer) return { ok: false, error: "Cliente no encontrado" };

    const { data: addr } = await admin
      .from("addresses")
      .select("street_type, street, street_number, postal_code, city, province")
      .eq("customer_id", customer.id)
      .eq("is_primary", true)
      .is("deleted_at", null)
      .maybeSingle();

    const { data: series } = await admin
      .from("invoice_series")
      .select("id")
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!series) {
      return {
        ok: false,
        error: "No hay serie de facturación. Crea una en /configuracion/facturacion",
      };
    }

    const customerSnapshot = {
      legal_name: customer.legal_name,
      trade_name: customer.trade_name,
      first_name: customer.first_name,
      last_name: customer.last_name,
      tax_id: customer.tax_id,
      email: customer.email,
      phone: customer.phone_primary,
      address: addr
        ? `${addr.street_type ?? ""} ${addr.street ?? ""} ${addr.street_number ?? ""}`.trim()
        : null,
      postal_code: addr?.postal_code,
      city: addr?.city,
      province: addr?.province,
      country: "ES",
    };

    const dueDays = options?.due_days ?? 30;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + dueDays);

    const { data: created, error: insErr } = await admin
      .from("invoices")
      .insert({
        company_id: session.company_id,
        series_id: series.id,
        invoice_type: "F1",
        status: "draft",
        customer_id: customer.id,
        customer_snapshot: customerSnapshot,
        contract_id: contract.id,
        subtotal_cents: 0,
        tax_total_cents: 0,
        total_cents: 0,
        due_at: dueAt.toISOString().slice(0, 10),
        operation_at: new Date().toISOString().slice(0, 10),
        description: options?.description ?? null,
        payment_method: "transferencia",
        created_by: session.user_id,
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("[createInvoiceFromContract] insert failed:", insErr.message);
      return { ok: false, error: insErr.message };
    }
    const invoiceId = (created as { id: string }).id;

    // Copiar items contrato → líneas factura
    const { data: contractItems } = await admin
      .from("contract_items")
      .select("product_id, quantity, display_order, notes, unit_price_cents")
      .eq("contract_id", contract.id);

    type CI = {
      product_id: string;
      quantity: number;
      display_order: number;
      notes: string | null;
      unit_price_cents: number;
    };
    const items = (contractItems ?? []) as CI[];

    let subtotal = 0;
    let tax = 0;

    if (items.length > 0) {
      const ids = Array.from(new Set(items.map((i) => i.product_id)));
      const { data: prods } = await admin
        .from("products")
        .select("id, name")
        .in("id", ids);
      const nameMap = new Map(
        ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [
          p.id,
          p.name,
        ]),
      );

      const lines = items.map((it) => {
        const lineSubtotal = it.unit_price_cents * it.quantity;
        const lineTax = Math.round(lineSubtotal * 0.21);
        subtotal += lineSubtotal;
        tax += lineTax;
        return {
          invoice_id: invoiceId,
          display_order: it.display_order,
          product_id: it.product_id,
          description: nameMap.get(it.product_id) ?? "Producto",
          quantity: it.quantity,
          unit_price_cents: it.unit_price_cents,
          discount_pct: 0,
          subtotal_cents: lineSubtotal,
          tax_rate: 21,
          tax_cents: lineTax,
          retention_rate: 0,
          retention_cents: 0,
          total_cents: lineSubtotal + lineTax,
        };
      });
      await admin.from("invoice_lines").insert(lines);
      await admin.from("invoice_taxes").insert({
        invoice_id: invoiceId,
        tax_rate: 21,
        base_cents: subtotal,
        tax_cents: tax,
      });
    } else {
      const baseAmount = contract.total_cash_cents ?? contract.monthly_cents ?? 0;
      if (baseAmount > 0) {
        subtotal = Math.round(baseAmount / 1.21);
        tax = baseAmount - subtotal;
        await admin.from("invoice_lines").insert({
          invoice_id: invoiceId,
          display_order: 0,
          description: options?.description ?? "Servicio según contrato",
          quantity: 1,
          unit_price_cents: subtotal,
          subtotal_cents: subtotal,
          tax_rate: 21,
          tax_cents: tax,
          total_cents: subtotal + tax,
        });
        await admin.from("invoice_taxes").insert({
          invoice_id: invoiceId,
          tax_rate: 21,
          base_cents: subtotal,
          tax_cents: tax,
        });
      }
    }

    await admin
      .from("invoices")
      .update({
        subtotal_cents: subtotal,
        tax_total_cents: tax,
        total_cents: subtotal + tax,
      })
      .eq("id", invoiceId);

    revalidatePath("/facturas");
    revalidatePath(`/contratos/${contractId}`);
    return { ok: true, id: invoiceId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * EMITIR factura: numera correlativamente, calcula hash Verifactu
 * encadenado, genera URL del QR. INMUTABLE a partir de aquí.
 */
export async function issueInvoiceV2Action(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await ensureAdminResult();
    if (!g.ok) return g;
    const { session } = g;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: inv } = await admin
      .from("invoices")
      .select(
        `id, company_id, series_id, invoice_type, status, customer_snapshot,
         total_cents, tax_total_cents, subtotal_cents`,
      )
      .eq("id", invoiceId)
      .single();
    if (!inv) return { ok: false, error: "Factura no encontrada" };
    if (inv.status !== "draft") {
      return { ok: false, error: "Solo se pueden emitir facturas en estado borrador" };
    }
    if (inv.total_cents <= 0) {
      return { ok: false, error: "La factura no tiene importe" };
    }
    if (inv.company_id !== session.company_id) {
      return { ok: false, error: "Factura de otra empresa" };
    }

    const { data: companySettings } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, verifactu_mode, verifactu_environment",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const cs = companySettings as {
      fiscal_legal_name: string | null;
      fiscal_tax_id: string | null;
      verifactu_mode: "no_envio" | "verifactu" | "verifactu_test" | null;
      verifactu_environment: "production" | "test" | "sandbox" | null;
    } | null;
    const issuerNif = cs?.fiscal_tax_id;
    const issuerName = cs?.fiscal_legal_name;
    if (!issuerNif || !issuerName) {
      return {
        ok: false,
        error: "Faltan datos fiscales de la empresa (CIF y razón social). Configúralos en /configuracion/fiscal",
      };
    }

    // Asignar número correlativo (función SQL atómica)
    const { data: numResult, error: numErr } = await admin.rpc(
      "allocate_next_invoice_number",
      { p_series_id: inv.series_id },
    );
    if (numErr) return { ok: false, error: numErr.message };
    const invoiceNumber = numResult as number;

    const { data: seriesRow } = await admin
      .from("invoice_series")
      .select("series_code, prefix, current_year")
      .eq("id", inv.series_id)
      .single();
    const series = {
      code: seriesRow.series_code,
      prefix: seriesRow.prefix,
      current_year: seriesRow.current_year,
    };
    const referenceCode = `${series.prefix ?? ""}${series.code}-${series.current_year}-${String(invoiceNumber).padStart(4, "0")}`;

    // Hash anterior (cadena por empresa)
    const { data: prevRecord } = await admin
      .from("invoice_verifactu_records")
      .select("current_hash")
      .eq("company_id", session.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevHash =
      (prevRecord as { current_hash: string } | null)?.current_hash ?? "";

    const issuedAt = new Date();
    const isTest = cs.verifactu_environment !== "production";

    const customerSnap = inv.customer_snapshot as {
      tax_id?: string;
      trade_name?: string;
      legal_name?: string;
      first_name?: string;
      last_name?: string;
    };
    const recipientNif = customerSnap?.tax_id ?? null;
    const recipientName =
      customerSnap?.trade_name ||
      customerSnap?.legal_name ||
      `${customerSnap?.first_name ?? ""} ${customerSnap?.last_name ?? ""}`.trim() ||
      null;

    const currentHash = computeVerifactuHash({
      issuer_nif: issuerNif,
      series_code: series.code,
      invoice_number: invoiceNumber,
      invoice_type: inv.invoice_type,
      issued_at: issuedAt,
      operation_date: issuedAt,
      total_cents: inv.total_cents,
      tax_cents: inv.tax_total_cents,
      prev_hash: prevHash,
      record_type: "alta",
    });

    const qrUrl = buildVerifactuQrUrl({
      issuer_nif: issuerNif,
      series_code: series.code,
      invoice_number: invoiceNumber,
      issued_at: issuedAt,
      total_cents: inv.total_cents,
      test: isTest,
    });

    const { error: updErr } = await admin
      .from("invoices")
      .update({
        status: "issued",
        number: invoiceNumber,
        reference_code: referenceCode,
        issued_at: issuedAt.toISOString(),
        verifactu_hash: currentHash,
        verifactu_prev_hash: prevHash,
        verifactu_qr_url: qrUrl,
        issued_by: session.user_id,
      })
      .eq("id", invoiceId);
    if (updErr) {
      console.error("[issueInvoice] update failed:", updErr.message);
      return { ok: false, error: updErr.message };
    }

    const { error: recErr } = await admin
      .from("invoice_verifactu_records")
      .insert({
        company_id: session.company_id,
        invoice_id: invoiceId,
        record_type: "alta",
        issuer_nif: issuerNif,
        issuer_name: issuerName,
        series_code: series.code,
        invoice_number: invoiceNumber,
        invoice_type: inv.invoice_type,
        issued_at: issuedAt.toISOString(),
        operation_date: issuedAt.toISOString().slice(0, 10),
        recipient_nif: recipientNif,
        recipient_name: recipientName,
        base_total_cents: inv.subtotal_cents,
        tax_total_cents: inv.tax_total_cents,
        total_cents: inv.total_cents,
        prev_hash: prevHash,
        current_hash: currentHash,
        qr_url: qrUrl,
        qr_params: {
          nif: issuerNif,
          numserie: `${series.code}/${invoiceNumber}`,
          fecha: issuedAt.toISOString().slice(0, 10),
          importe: (inv.total_cents / 100).toFixed(2),
        },
        sent_to_aeat: false,
      });
    if (recErr) {
      // Rollback
      await admin
        .from("invoices")
        .update({
          status: "draft",
          number: null,
          reference_code: null,
          issued_at: null,
          verifactu_hash: null,
          verifactu_prev_hash: null,
          verifactu_qr_url: null,
        })
        .eq("id", invoiceId);
      console.error("[issueInvoice] verifactu insert failed:", recErr.message);
      return { ok: false, error: recErr.message };
    }

    await admin.from("invoice_verifactu_events").insert({
      company_id: session.company_id,
      event_type: "invoice_create",
      severity: "info",
      payload: {
        invoice_id: invoiceId,
        reference_code: referenceCode,
        total_cents: inv.total_cents,
        hash: currentHash,
      },
      user_id: session.user_id,
    });

    revalidatePath("/facturas");
    revalidatePath(`/facturas/${invoiceId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/** Anular factura emitida — registro Verifactu de anulación encadenado. */
export async function cancelInvoiceV2Action(
  invoiceId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await ensureAdminResult();
    if (!g.ok) return g;
    const { session } = g;
    if (!reason.trim()) return { ok: false, error: "Motivo de anulación obligatorio" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: inv } = await admin
      .from("invoices")
      .select(
        `id, company_id, series_id, invoice_type, status, number,
         total_cents, tax_total_cents, subtotal_cents`,
      )
      .eq("id", invoiceId)
      .single();
    if (!inv) return { ok: false, error: "Factura no encontrada" };
    if (inv.company_id !== session.company_id)
      return { ok: false, error: "Factura de otra empresa" };
    if (!["issued", "sent_to_aeat", "accepted_aeat"].includes(inv.status)) {
      return { ok: false, error: "Solo se pueden anular facturas emitidas" };
    }

    const { data: cs } = await admin
      .from("company_settings")
      .select("fiscal_legal_name, fiscal_tax_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const issuerNif = (cs as { fiscal_tax_id: string | null } | null)?.fiscal_tax_id;
    const issuerName = (cs as { fiscal_legal_name: string | null } | null)
      ?.fiscal_legal_name;
    if (!issuerNif || !issuerName) return { ok: false, error: "Faltan datos fiscales" };

    const { data: seriesRow2 } = await admin
      .from("invoice_series")
      .select("series_code")
      .eq("id", inv.series_id)
      .single();
    const series = { code: seriesRow2.series_code };

    const { data: prevRecord } = await admin
      .from("invoice_verifactu_records")
      .select("current_hash")
      .eq("company_id", session.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevHash =
      (prevRecord as { current_hash: string } | null)?.current_hash ?? "";

    const cancelDate = new Date();
    const currentHash = computeVerifactuHash({
      issuer_nif: issuerNif,
      series_code: series.code,
      invoice_number: inv.number,
      invoice_type: inv.invoice_type,
      issued_at: cancelDate,
      operation_date: cancelDate,
      total_cents: inv.total_cents,
      tax_cents: inv.tax_total_cents,
      prev_hash: prevHash,
      record_type: "anulacion",
    });

    await admin.from("invoice_verifactu_records").insert({
      company_id: session.company_id,
      invoice_id: invoiceId,
      record_type: "anulacion",
      issuer_nif: issuerNif,
      issuer_name: issuerName,
      series_code: series.code,
      invoice_number: inv.number,
      invoice_type: inv.invoice_type,
      issued_at: cancelDate.toISOString(),
      operation_date: cancelDate.toISOString().slice(0, 10),
      base_total_cents: inv.subtotal_cents,
      tax_total_cents: inv.tax_total_cents,
      total_cents: inv.total_cents,
      prev_hash: prevHash,
      current_hash: currentHash,
      qr_url: "",
      qr_params: { reason },
    });

    await admin
      .from("invoices")
      .update({
        status: "cancelled",
        cancelled_at: cancelDate.toISOString(),
        cancelled_by: session.user_id,
        cancelled_reason: reason,
      })
      .eq("id", invoiceId);

    await admin.from("invoice_verifactu_events").insert({
      company_id: session.company_id,
      event_type: "invoice_cancel",
      severity: "warning",
      payload: { invoice_id: invoiceId, reason, hash: currentHash },
      user_id: session.user_id,
    });

    revalidatePath("/facturas");
    revalidatePath(`/facturas/${invoiceId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
