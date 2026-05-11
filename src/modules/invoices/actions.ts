"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { getFiscalSettings } from "@/modules/config/fiscal/actions";

export type InvoiceKind = "invoice" | "credit_note" | "proforma" | "delivery_note";
export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue" | "void" | "cancelled" | "proforma";

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin puede gestionar facturas");
  return session;
}

export interface InvoiceListItem {
  id: string;
  full_reference: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  customer_id: string;
  customer_name: string | null;
  contract_id: string | null;
  series_id: string;
  number: number;
  fiscal_year: number;
  issue_date: string;
  due_date: string | null;
  total_cents: number;
  pending_cents: number;
  /** ID de la factura rectificativa que rectifica a ESTA (si existe) */
  corrected_by_id: string | null;
  corrected_by_reference: string | null;
  /** ID de la factura original a la que ESTA rectifica (si es credit_note) */
  corrects_invoice_id: string | null;
  corrects_reference: string | null;
}

export interface InvoiceLine {
  id?: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_percent: number;
  tax_rate_percent: number;
  product_id?: string | null;
}

export interface InvoiceDetail {
  id: string;
  full_reference: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  series_id: string;
  number: number;
  fiscal_year: number;
  customer_id: string;
  customer_name: string | null;
  customer_fiscal_snapshot: Record<string, unknown> | null;
  company_fiscal_snapshot: Record<string, unknown> | null;
  contract_id: string | null;
  corrects_invoice_id: string | null;
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  subtotal_cents: number;
  tax_cents: number;
  withholdings_cents: number;
  total_cents: number;
  pending_cents: number;
  notes: string | null;
  lines: InvoiceLine[];
  payments: Array<{
    id: string;
    amount_cents: number;
    paid_at: string;
    wallet_entry_id: string | null;
    notes: string | null;
  }>;
}

interface SeriesRow {
  id: string;
  kind: InvoiceKind;
  series_code: string;
}

async function getOrSeedSeries(companyId: string, kind: InvoiceKind): Promise<SeriesRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let { data } = await admin
    .from("invoice_series")
    .select("id, kind, series_code")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("is_active", true)
    .order("series_code")
    .limit(1)
    .maybeSingle();
  if (!data) {
    // Intento sembrar la serie default desde RPC. Si la RPC no existe o falla,
    // capturamos el error para no tumbar el flujo con un error críptico.
    try {
      await admin.rpc("seed_default_invoice_series", { p_company_id: companyId });
    } catch (e) {
      console.error("[getOrSeedSeries] seed RPC failed:", e);
    }
    const r = await admin
      .from("invoice_series")
      .select("id, kind, series_code")
      .eq("company_id", companyId)
      .eq("kind", kind)
      .eq("is_active", true)
      .order("series_code")
      .limit(1)
      .maybeSingle();
    data = r.data;
  }
  if (!data) {
    const kindLabel: Record<string, string> = {
      invoice: "factura",
      proforma: "factura proforma",
      credit_note: "factura rectificativa",
      simplified: "factura simplificada",
    };
    throw new Error(
      `No tienes configurada una serie de facturación para ${kindLabel[kind] ?? kind}. Ve a Configuración → Facturación y crea al menos una serie activa.`,
    );
  }
  return data as SeriesRow;
}

function customerDisplayName(c: {
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (c.party_kind === "company") return c.trade_name || c.legal_name || "Cliente";
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";
}

function calcLineTotals(line: InvoiceLine) {
  const gross = line.unit_price_cents * line.quantity;
  const discount = Math.round((gross * line.discount_percent) / 100);
  const subtotal = gross - discount;
  const tax = Math.round((subtotal * line.tax_rate_percent) / 100);
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

export async function listInvoices(filters?: {
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  customer_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<InvoiceListItem[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const limit = Math.min(500, filters?.limit ?? 50);
  const offset = Math.max(0, filters?.offset ?? 0);
  let query = admin
    .from("invoices")
    .select(
      "id, full_reference, kind, status, customer_id, contract_id, series_id, number, fiscal_year, issue_date, due_date, total_cents, corrects_invoice_id",
    )
    .eq("company_id", session.company_id)
    .order("issue_date", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.kind) query = query.eq("kind", filters.kind);
  if (filters?.customer_id) query = query.eq("customer_id", filters.customer_id);
  if (filters?.q) {
    const q = filters.q.replace(/[%_]/g, "");
    query = query.ilike("full_reference", `%${q}%`);
  }
  const { data } = await query;
  type R = {
    id: string;
    full_reference: string;
    kind: InvoiceKind;
    status: InvoiceStatus;
    customer_id: string;
    contract_id: string | null;
    series_id: string;
    number: number;
    fiscal_year: number;
    issue_date: string;
    due_date: string | null;
    total_cents: number;
    corrects_invoice_id: string | null;
  };
  const rows = (data ?? []) as R[];
  if (rows.length === 0) return [];

  // Resolver nombres de cliente
  const cIds = Array.from(new Set(rows.map((r) => r.customer_id)));
  const { data: cs } = await admin
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .in("id", cIds);
  const nameMap = new Map<string, string>();
  for (const c of (cs ?? []) as Array<{
    id: string;
    party_kind: "individual" | "company";
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  }>) {
    nameMap.set(c.id, customerDisplayName(c));
  }

  // Pendiente = total - sum(payments)
  const ids = rows.map((r) => r.id);
  const { data: pays } = await admin
    .from("invoice_payments")
    .select("invoice_id, amount_cents")
    .in("invoice_id", ids);
  const paidMap = new Map<string, number>();
  for (const p of (pays ?? []) as Array<{ invoice_id: string; amount_cents: number }>) {
    paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + p.amount_cents);
  }

  // Rectificativas: detectar qué facturas TIENEN una credit_note que las anula.
  // Buscamos credit_notes que apunten a estas facturas.
  const { data: rects } = await admin
    .from("invoices")
    .select("id, full_reference, corrects_invoice_id")
    .eq("kind", "credit_note")
    .in("corrects_invoice_id", ids);
  const rectMap = new Map<string, { id: string; ref: string }>();
  for (const r of (rects ?? []) as Array<{
    id: string;
    full_reference: string;
    corrects_invoice_id: string | null;
  }>) {
    if (r.corrects_invoice_id) {
      rectMap.set(r.corrects_invoice_id, { id: r.id, ref: r.full_reference });
    }
  }
  // Y para credit_notes, resolver referencia de la original.
  const origIds = Array.from(
    new Set(
      rows
        .filter((r) => r.corrects_invoice_id)
        .map((r) => r.corrects_invoice_id as string),
    ),
  );
  const origMap = new Map<string, string>();
  if (origIds.length > 0) {
    const { data: origs } = await admin
      .from("invoices")
      .select("id, full_reference")
      .in("id", origIds);
    for (const o of (origs ?? []) as Array<{ id: string; full_reference: string }>) {
      origMap.set(o.id, o.full_reference);
    }
  }

  return rows.map((r) => {
    // Si status='paid', 'cancelled' o 'void' → pending=0 aunque no haya
    // payments registrados (evita inconsistencia "Cobrada" con pendiente).
    const isClosed = r.status === "paid" || r.status === "cancelled" || r.status === "void";
    const pending = isClosed ? 0 : r.total_cents - (paidMap.get(r.id) ?? 0);
    const rect = rectMap.get(r.id) ?? null;
    return {
      ...r,
      customer_name: nameMap.get(r.customer_id) ?? null,
      pending_cents: pending,
      corrected_by_id: rect?.id ?? null,
      corrected_by_reference: rect?.ref ?? null,
      corrects_reference: r.corrects_invoice_id
        ? origMap.get(r.corrects_invoice_id) ?? null
        : null,
    };
  });
}

export async function getInvoice(id: string): Promise<InvoiceDetail> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inv } = await admin
    .from("invoices")
    .select(
      "id, full_reference, kind, status, series_id, number, fiscal_year, customer_id, customer_fiscal_snapshot, company_fiscal_snapshot, contract_id, corrects_invoice_id, issue_date, due_date, paid_at, subtotal_cents, tax_cents, withholdings_cents, total_cents, notes, company_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!inv) throw new Error("Factura no encontrada");
  if ((inv as { company_id: string }).company_id !== session.company_id)
    throw new Error("Otra empresa");

  const { data: cust } = await admin
    .from("customers")
    .select("id, party_kind, legal_name, trade_name, first_name, last_name")
    .eq("id", (inv as { customer_id: string }).customer_id)
    .maybeSingle();
  const customerName = cust ? customerDisplayName(cust as never) : null;

  const { data: lines } = await admin
    .from("invoice_lines")
    .select(
      "id, description, quantity, unit_price_cents, discount_percent, tax_rate_percent, product_id",
    )
    .eq("invoice_id", id)
    .order("display_order", { ascending: true });

  const { data: pays } = await admin
    .from("invoice_payments")
    .select("id, amount_cents, paid_at, wallet_entry_id, notes")
    .eq("invoice_id", id)
    .order("paid_at", { ascending: true });
  const paid = ((pays ?? []) as Array<{ amount_cents: number }>).reduce(
    (s, p) => s + p.amount_cents,
    0,
  );

  return {
    ...(inv as Omit<InvoiceDetail, "customer_name" | "lines" | "payments" | "pending_cents">),
    customer_name: customerName,
    lines: ((lines ?? []) as InvoiceLine[]).map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      discount_percent: Number(l.discount_percent),
      tax_rate_percent: Number(l.tax_rate_percent),
    })),
    payments: (pays ?? []) as InvoiceDetail["payments"],
    pending_cents: (inv as { total_cents: number }).total_cents - paid,
  };
}

interface CreateInvoiceInput {
  customer_id: string;
  contract_id?: string | null;
  kind?: InvoiceKind;
  due_date?: string | null;
  notes?: string | null;
  lines: InvoiceLine[];
  corrects_invoice_id?: string | null;
}

export async function createInvoiceAction(input: CreateInvoiceInput): Promise<string> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!input.lines || input.lines.length === 0) throw new Error("Añade al menos una línea");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const kind: InvoiceKind = input.kind ?? "invoice";
  const series = await getOrSeedSeries(session.company_id, kind);
  // Función canónica en schema public (Verifactu 2026-05-07). Devuelve
  // bigint con el número. La anterior app.next_invoice_number quedó
  // obsoleta (no visible en PostgREST por estar en schema app).
  const { data: nextNum, error: e1 } = await admin.rpc(
    "allocate_next_invoice_number",
    { p_series_id: series.id },
  );
  if (e1) throw new Error(e1.message);
  const num = Number(nextNum);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("No se pudo asignar número de factura");
  }
  const fiscalYear = new Date().getFullYear();
  const fullRef = `${series.series_code}-${fiscalYear}-${String(num).padStart(5, "0")}`;

  // Snapshots
  const fiscal = await getFiscalSettings();
  const { data: cust } = await admin
    .from("customers")
    .select(
      "id, party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
    )
    .eq("id", input.customer_id)
    .maybeSingle();
  const { data: addr } = await admin
    .from("addresses")
    .select("street, street_number, postal_code, city, province")
    .eq("customer_id", input.customer_id)
    .eq("is_primary", true)
    .maybeSingle();

  // Calcular totales
  let subtotal = 0;
  let tax = 0;
  for (const l of input.lines) {
    const t = calcLineTotals(l);
    subtotal += t.subtotal_cents;
    tax += t.tax_cents;
  }
  const total = subtotal + tax;

  const { data: created, error: e2 } = await admin
    .from("invoices")
    .insert({
      company_id: session.company_id,
      customer_id: input.customer_id,
      contract_id: input.contract_id ?? null,
      kind,
      series_id: series.id,
      number: num,
      fiscal_year: fiscalYear,
      full_reference: fullRef,
      status: "draft",
      customer_fiscal_snapshot: { ...(cust ?? {}), address: addr ?? null },
      company_fiscal_snapshot: fiscal,
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: total,
      withholdings_cents: 0,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date:
        input.due_date ??
        new Date(Date.now() + (fiscal.invoice_default_due_days ?? 30) * 86400000)
          .toISOString()
          .slice(0, 10),
      corrects_invoice_id: input.corrects_invoice_id ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (e2) throw new Error(e2.message);
  const invoiceId = (created as { id: string }).id;

  await admin.from("invoice_lines").insert(
    input.lines.map((l, idx) => {
      const t = calcLineTotals(l);
      return {
        invoice_id: invoiceId,
        company_id: session.company_id,
        product_id: l.product_id ?? null,
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        discount_percent: l.discount_percent,
        tax_rate_percent: l.tax_rate_percent,
        subtotal_cents: t.subtotal_cents,
        tax_cents: t.tax_cents,
        total_cents: t.total_cents,
        display_order: idx,
      };
    }),
  );

  await admin.from("events").insert({
    company_id: session.company_id,
    subject_type: "contract",
    subject_id: input.contract_id ?? invoiceId,
    kind: "invoice.created",
    payload: { invoice_id: invoiceId, full_reference: fullRef },
    actor_user_id: session.user_id,
  });

  revalidatePath("/facturas");
  return invoiceId;
}

export async function markInvoiceIssuedAction(invoiceId: string): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("invoices")
    .update({ status: "issued" })
    .eq("id", invoiceId)
    .eq("company_id", session.company_id)
    .eq("status", "draft");

  // Trazabilidad: enlazar invoice_id en los stock_movements del contrato
  // que aún no tengan factura. Fail-soft (la columna puede no existir si
  // la migración Fase A no se aplicó).
  try {
    const { data: inv } = await admin
      .from("invoices")
      .select("contract_id")
      .eq("id", invoiceId)
      .maybeSingle();
    const cid = (inv as { contract_id: string | null } | null)?.contract_id;
    if (cid) {
      await admin
        .from("stock_movements")
        .update({ invoice_id: invoiceId })
        .eq("contract_id", cid)
        .is("invoice_id", null);
    }
  } catch (e) {
    console.warn("[markInvoiceIssued] no se pudo enlazar invoice_id a stock_movements:", e);
  }

  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/facturas");
}

export async function markInvoicePaidAction(
  invoiceId: string,
  amount_cents?: number,
): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inv } = await admin
    .from("invoices")
    .select("id, total_cents, contract_id, customer_id")
    .eq("id", invoiceId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!inv) throw new Error("Factura no encontrada");
  const { data: pays } = await admin
    .from("invoice_payments")
    .select("amount_cents")
    .eq("invoice_id", invoiceId);
  const alreadyPaid = ((pays ?? []) as Array<{ amount_cents: number }>).reduce(
    (s, p) => s + p.amount_cents,
    0,
  );
  const pending = (inv as { total_cents: number }).total_cents - alreadyPaid;
  const amt = amount_cents ?? pending;
  if (amt <= 0) throw new Error("La factura ya está totalmente pagada");

  // Crear wallet entry validada para que cuadre con la entrada manual
  // (el flujo natural debería ser desde wallet, pero soportamos esta dirección)
  const { data: walletEntry } = await admin
    .from("wallet_entries")
    .insert({
      company_id: session.company_id,
      contract_id: (inv as { contract_id: string | null }).contract_id,
      customer_id: (inv as { customer_id: string }).customer_id,
      concept: `Cobro factura ${invoiceId}`,
      amount_cents: amt,
      method: "transfer",
      status: "validated",
      collected_at: new Date().toISOString(),
      validated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  await admin.from("invoice_payments").insert({
    company_id: session.company_id,
    invoice_id: invoiceId,
    wallet_entry_id: (walletEntry as { id: string } | null)?.id ?? null,
    amount_cents: amt,
    created_by: session.user_id,
  });

  // Si llega al total, marca la factura como pagada
  if (alreadyPaid + amt >= (inv as { total_cents: number }).total_cents) {
    await admin
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }
  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/facturas");
  revalidatePath("/wallet");
}

export async function cancelInvoiceAction(invoiceId: string, reason?: string): Promise<void> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin
    .from("invoices")
    .update({ status: "cancelled", notes: reason ?? null })
    .eq("id", invoiceId)
    .eq("company_id", session.company_id);
  revalidatePath(`/facturas/${invoiceId}`);
  revalidatePath("/facturas");
}

/**
 * Borra o rectifica una factura según las reglas fiscales:
 *
 * - Si es un BORRADOR (status='draft') Y es la ÚLTIMA de la numeración en
 *   su serie/año fiscal → permitir DELETE duro (la numeración mantiene su
 *   continuidad porque liberamos el último número).
 * - Si NO es draft o NO es la última → forzar RECTIFICATIVA (credit_note)
 *   que la anule contablemente sin romper la numeración.
 *
 * Devuelve:
 *   { deleted: true } si la borró
 *   { deleted: false, credit_note_id } si creó rectificativa
 */
export async function deleteOrRectifyInvoiceAction(
  invoiceId: string,
): Promise<{ deleted: boolean; credit_note_id?: string }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inv } = await admin
    .from("invoices")
    .select("id, status, kind, series_id, number, fiscal_year")
    .eq("id", invoiceId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!inv) throw new Error("Factura no encontrada");
  const i = inv as {
    id: string;
    status: string;
    kind: string;
    series_id: string;
    number: number;
    fiscal_year: number;
  };

  // Comprobar si es la última de su numeración (no hay otra con número
  // mayor en la misma serie + año).
  const { data: laterRows } = await admin
    .from("invoices")
    .select("id")
    .eq("company_id", session.company_id)
    .eq("series_id", i.series_id)
    .eq("fiscal_year", i.fiscal_year)
    .gt("number", i.number)
    .limit(1);
  const isLast = ((laterRows ?? []) as Array<unknown>).length === 0;

  // Comprobar si ya existe una rectificativa que la corrige.
  const { data: existingCredit } = await admin
    .from("invoices")
    .select("id")
    .eq("corrects_invoice_id", invoiceId)
    .eq("kind", "credit_note")
    .limit(1)
    .maybeSingle();
  if (existingCredit) {
    throw new Error(
      "Esta factura ya tiene una rectificativa. No se puede volver a anular.",
    );
  }

  // Caso 1: borrado duro permitido.
  if (i.status === "draft" && isLast) {
    // Liberar el número para que la siguiente factura tome este número
    // (decrementar next_number de la serie).
    await admin
      .from("invoice_series")
      .update({ next_number: i.number })
      .eq("id", i.series_id)
      .gte("next_number", i.number + 1);
    // Borrar líneas y pagos primero (FK)
    await admin.from("invoice_lines").delete().eq("invoice_id", invoiceId);
    await admin.from("invoice_payments").delete().eq("invoice_id", invoiceId);
    await admin.from("invoices").delete().eq("id", invoiceId);
    revalidatePath("/facturas");
    return { deleted: true };
  }

  // Caso 2: rectificar. Si está en draft pero no es la última, también
  // forzamos rectificativa para mantener la numeración continua.
  const creditId = await createCreditNoteAction(invoiceId);
  // Marcar la original como cancelled si no lo estaba ya y NO está pagada.
  // Si estaba pagada, la rectificativa generará un cobro negativo.
  if (i.status !== "paid" && i.status !== "cancelled") {
    await admin
      .from("invoices")
      .update({ status: "cancelled" })
      .eq("id", invoiceId);
  }
  revalidatePath("/facturas");
  return { deleted: false, credit_note_id: creditId };
}

/**
 * Crea una factura rectificativa (nota de crédito) que anula la original.
 * Copia las líneas con cantidades en negativo.
 */
export async function createCreditNoteAction(originalId: string): Promise<string> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  const orig = await getInvoice(originalId);
  return createInvoiceAction({
    customer_id: orig.customer_id,
    contract_id: orig.contract_id,
    kind: "credit_note",
    corrects_invoice_id: originalId,
    notes: `Rectificativa de ${orig.full_reference}`,
    lines: orig.lines.map((l) => ({
      description: l.description,
      quantity: -Math.abs(l.quantity),
      unit_price_cents: l.unit_price_cents,
      discount_percent: l.discount_percent,
      tax_rate_percent: l.tax_rate_percent,
      product_id: l.product_id ?? null,
    })),
  });
}

/**
 * Crea una factura a partir de un contrato firmado: una línea por contract_item.
 */
export async function createInvoiceFromContractAction(contractId: string): Promise<string> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: c } = await admin
    .from("contracts")
    .select(
      "id, customer_id, total_cash_cents, monthly_cents, plan_type, status, service_start_date, signed_at, reference_code",
    )
    .eq("id", contractId)
    .maybeSingle();
  if (!c) throw new Error("Contrato no encontrado");
  const con = c as {
    id: string;
    customer_id: string;
    total_cash_cents: number | null;
    monthly_cents: number | null;
    plan_type: "cash" | "rental" | "renting";
    status: string;
    service_start_date: string | null;
    signed_at: string | null;
    reference_code: string | null;
  };

  // Guard: no se puede facturar un contrato que no esté en vigor.
  // - Para CASH (compra al contado): requiere instalación completada
  //   (contract.status='active' tras completeInstallation o cron de
  //   activación por service_start_date).
  // - Para RENTAL/RENTING: el alquiler/renting entra en vigor con la fecha
  //   pactada (service_start_date). No se puede facturar antes de esa fecha.
  if (con.status === "draft" || con.status === "pending_data") {
    throw new Error(
      `El contrato ${con.reference_code ?? ""} no está firmado todavía. Firma primero.`.trim(),
    );
  }
  if (con.status === "cancelled") {
    throw new Error("No se puede facturar un contrato cancelado.");
  }
  // Tanto venta como alquiler/renting REQUIEREN instalación completada
  // (decisión usuario 2026-05-10: "el alquiler entra en vigor desde la fecha
  // de instalación"). Buscamos la instalación 'normal' completada del
  // contrato. Otros kinds (uninstall/relocation/free_trial) no cuentan.
  const { data: instRows } = await admin
    .from("installations")
    .select("id, status, completed_at, kind")
    .eq("contract_id", contractId)
    .in("kind", ["normal"])
    .order("completed_at", { ascending: false });
  type InstRow = {
    id: string;
    status: string;
    completed_at: string | null;
    kind: string;
  };
  const completedInstall = ((instRows ?? []) as InstRow[]).find(
    (i) => i.status === "completed" && i.completed_at,
  );
  if (!completedInstall) {
    throw new Error(
      con.plan_type === "cash"
        ? "No se puede facturar la venta hasta que la instalación esté completada."
        : "No se puede facturar el alquiler hasta que la instalación esté completada (entra en vigor desde la fecha de instalación).",
    );
  }
  // Si rental/renting tiene service_start_date EXPLÍCITA en futuro respecto
  // a la instalación, esa fecha manda (caso "instalo el día 18 pero arranca
  // el 1 del mes siguiente"). Si no hay override, vale la fecha de instalación.
  if (con.plan_type !== "cash" && con.service_start_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(con.service_start_date);
    startDate.setHours(0, 0, 0, 0);
    if (startDate.getTime() > today.getTime()) {
      throw new Error(
        `Este ${con.plan_type === "rental" ? "alquiler" : "renting"} arranca el ${startDate.toLocaleDateString(
          "es-ES",
        )} (fecha pactada). No se puede facturar antes.`,
      );
    }
  }

  const { data: items } = await admin
    .from("contract_items")
    .select("product_name_snapshot, quantity, unit_price_cash_cents")
    .eq("contract_id", contractId);
  type CI = {
    product_name_snapshot: string;
    quantity: number;
    unit_price_cash_cents: number | null;
  };
  const ci = (items ?? []) as CI[];
  const fiscal = await getFiscalSettings();
  const lines: InvoiceLine[] =
    ci.length > 0
      ? ci.map((it) => ({
          description: it.product_name_snapshot,
          quantity: it.quantity,
          unit_price_cents: it.unit_price_cash_cents ?? 0,
          discount_percent: 0,
          tax_rate_percent: fiscal.invoice_default_iva,
        }))
      : [
          {
            description: `Contrato ${con.plan_type}`,
            quantity: 1,
            unit_price_cents:
              con.plan_type === "cash" ? con.total_cash_cents ?? 0 : con.monthly_cents ?? 0,
            discount_percent: 0,
            tax_rate_percent: fiscal.invoice_default_iva,
          },
        ];

  return createInvoiceAction({
    customer_id: con.customer_id,
    contract_id: contractId,
    lines,
  });
}

// createInvoiceFromWalletEntryAction → ELIMINADA (2026-05-11). La función
// canónica es wallet/actions.ts:createInvoiceFromWalletAction. Tiene los
// guards completos (tax_id, dirección, status válido), devuelve result
// pattern { ok, invoice_id, error } que la UI usa, marca status='paid' y
// crea invoice_payments. La versión anterior aquí estaba huérfana.

/**
 * Genera facturas mensuales para todos los contratos activos con cuota
 * (alquiler/renting). Idempotente: no duplica si ya hay factura del mes.
 */
export async function generateMonthlyRecurringInvoicesAction(): Promise<{ created: number }> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: contracts } = await admin
    .from("contracts")
    .select("id, customer_id, monthly_cents, plan_type, status")
    .eq("company_id", session.company_id)
    .in("plan_type", ["rental", "renting"])
    .eq("status", "signed")
    .is("deleted_at", null);
  type C = {
    id: string;
    customer_id: string;
    monthly_cents: number | null;
    plan_type: string;
    status: string;
  };
  const list = ((contracts ?? []) as C[]).filter((c) => c.monthly_cents && c.monthly_cents > 0);
  let created = 0;
  const fiscal = await getFiscalSettings();
  for (const c of list) {
    // Comprobar si ya hay factura para este contrato este mes
    const { data: existing } = await admin
      .from("invoices")
      .select("id")
      .eq("contract_id", c.id)
      .gte("issue_date", monthStart)
      .limit(1)
      .maybeSingle();
    if (existing) continue;
    const monthLabel = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    const baseCents = Math.round((c.monthly_cents ?? 0) / (1 + fiscal.invoice_default_iva / 100));
    await createInvoiceAction({
      customer_id: c.customer_id,
      contract_id: c.id,
      lines: [
        {
          description: `Cuota ${monthLabel}`,
          quantity: 1,
          unit_price_cents: baseCents,
          discount_percent: 0,
          tax_rate_percent: fiscal.invoice_default_iva,
        },
      ],
    });
    created++;
  }
  return { created };
}
