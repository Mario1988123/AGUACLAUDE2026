import "server-only";

import { loadFiscalSettings, type FiscalSettings } from "@/modules/config/fiscal/load";
import { isBusinessParty } from "@/modules/proposals/pick-price";
import { madridDateKey } from "@/shared/lib/format-date";
import type { InvoiceKind, InvoiceLine } from "./actions";

/**
 * NÚCLEO DE CREACIÓN DE FACTURAS, SIN SESIÓN
 *
 * `createInvoiceAction` (facturación manual) y el cron diario tienen que crear
 * facturas por el MISMO camino: serie fiscal → `allocate_next_invoice_number`
 * → `full_reference`. Antes no era así: el cron insertaba a pelo en `invoices`
 * con una columna inventada (`pending_cents`) y sin `series_id`, `number`,
 * `fiscal_year` ni `full_reference`, las cuatro NOT NULL sin default. Es decir,
 * la cuota mensual de alquiler no es que se rompiera: no pudo funcionar nunca.
 *
 * Aquí no hay `"use server"` a propósito: esto acepta un `company_id` y no
 * puede quedar expuesto como server action.
 */

export interface SeriesRow {
  id: string;
  kind: InvoiceKind;
  series_code: string;
}

export function calcLineTotals(line: InvoiceLine) {
  const gross = line.unit_price_cents * line.quantity;
  const discount = Math.round((gross * line.discount_percent) / 100);
  const subtotal = gross - discount;
  const tax = Math.round((subtotal * line.tax_rate_percent) / 100);
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

const KIND_LABEL: Record<string, string> = {
  invoice: "factura",
  proforma: "factura proforma",
  credit_note: "factura rectificativa",
  simplified: "factura simplificada",
};

/** Serie activa de la empresa para ese tipo; la siembra si no existe. */
export async function getOrSeedSeries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  kind: InvoiceKind,
): Promise<SeriesRow> {
  const sel = () =>
    admin
      .from("invoice_series")
      .select("id, kind, series_code")
      .eq("company_id", companyId)
      .eq("kind", kind)
      .eq("is_active", true)
      .order("series_code")
      .limit(1)
      .maybeSingle();

  let { data } = await sel();
  if (!data) {
    // Siembra perezosa. La RPC es service_role (ver migración
    // 20260828100000_seed_wrappers_service_role); si no existe o falla,
    // lo registramos y dejamos que el error final sea legible.
    try {
      await admin.rpc("seed_default_invoice_series", { p_company_id: companyId });
    } catch (e) {
      console.error("[getOrSeedSeries] seed RPC failed:", e);
    }
    const r = await sel();
    data = r.data;
  }
  if (!data) {
    throw new Error(
      `No tienes configurada una serie de facturación para ${KIND_LABEL[kind] ?? kind}. Ve a Configuración → Facturación y crea al menos una serie activa.`,
    );
  }
  return data as SeriesRow;
}

/** Reserva el siguiente número de la serie y compone la referencia completa. */
export async function allocateInvoiceNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  series: SeriesRow,
): Promise<{ number: number; fiscal_year: number; full_reference: string }> {
  // Función canónica en schema public (Verifactu 2026-05-07). La anterior
  // app.next_invoice_number quedó obsoleta (no visible en PostgREST).
  const { data: nextNum, error } = await admin.rpc("allocate_next_invoice_number", {
    p_series_id: series.id,
  });
  if (error) throw new Error(error.message);
  const num = Number(nextNum);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("No se pudo asignar número de factura");
  }
  // Año fiscal por hora de Madrid: el cron corre a las 22:00 UTC, que el 31 de
  // diciembre ya es 1 de enero en España. Con getFullYear() de UTC la primera
  // factura del año nuevo se numeraría en el ejercicio anterior.
  const fiscalYear = Number(madridDateKey(new Date()).slice(0, 4));
  return {
    number: num,
    fiscal_year: fiscalYear,
    full_reference: `${series.series_code}-${fiscalYear}-${String(num).padStart(5, "0")}`,
  };
}

export interface CreateInvoiceCoreInput {
  customer_id?: string | null;
  financier_id?: string | null;
  contract_id?: string | null;
  kind?: InvoiceKind;
  due_date?: string | null;
  notes?: string | null;
  lines: InvoiceLine[];
  corrects_invoice_id?: string | null;
  maintenance_contract_id?: string | null;
  billing_period?: string | null;
}

export interface CreateInvoiceCoreArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  companyId: string;
  /** Quién la crea. El cron no es nadie: null. */
  actorUserId: string | null;
  input: CreateInvoiceCoreInput;
  /** Fiscal ya cargado (el cron lo cachea por empresa). Si no, se carga. */
  fiscal?: FiscalSettings;
}

export async function createInvoiceCore({
  admin,
  companyId,
  actorUserId,
  input,
  fiscal: fiscalIn,
}: CreateInvoiceCoreArgs): Promise<{ id: string; full_reference: string }> {
  if (!input.lines || input.lines.length === 0) {
    throw new Error("Añade al menos una línea");
  }
  if (!input.customer_id && !input.financier_id) {
    throw new Error("La factura necesita un destinatario (customer_id o financier_id)");
  }

  const kind: InvoiceKind = input.kind ?? "invoice";
  const series = await getOrSeedSeries(admin, companyId, kind);
  const numbering = await allocateInvoiceNumber(admin, series);

  const fiscal = fiscalIn ?? (await loadFiscalSettings(admin, companyId));

  // Snapshots — la fuente depende de si el destinatario es cliente o financiera.
  let recipientSnapshot: Record<string, unknown> = {};
  if (input.financier_id) {
    const { data: fin } = await admin
      .from("financiers")
      .select(
        "id, name, fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country, fiscal_email, fiscal_phone, fiscal_iban",
      )
      .eq("id", input.financier_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const f = fin as Record<string, unknown> | null;
    if (!f) throw new Error("Financiera no encontrada");
    recipientSnapshot = {
      kind: "financier",
      party_kind: "company",
      legal_name: f.fiscal_legal_name ?? f.name,
      tax_id: f.fiscal_tax_id ?? null,
      email: f.fiscal_email ?? null,
      phone_primary: f.fiscal_phone ?? null,
      iban: f.fiscal_iban ?? null,
      address: {
        street: f.fiscal_street ?? null,
        postal_code: f.fiscal_postal_code ?? null,
        city: f.fiscal_city ?? null,
        province: f.fiscal_province ?? null,
        country: f.fiscal_country ?? "España",
      },
    };
  } else if (input.customer_id) {
    const { data: cust } = await admin
      .from("customers")
      .select(
        "id, party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
      )
      .eq("id", input.customer_id)
      .eq("company_id", companyId)
      .maybeSingle();
    const { data: addr } = await admin
      .from("addresses")
      .select("street, street_number, postal_code, city, province")
      .eq("customer_id", input.customer_id)
      .eq("is_primary", true)
      .maybeSingle();
    recipientSnapshot = { ...(cust ?? {}), address: addr ?? null };
  }

  let subtotal = 0;
  let tax = 0;
  for (const l of input.lines) {
    const t = calcLineTotals(l);
    subtotal += t.subtotal_cents;
    tax += t.tax_cents;
  }
  const total = subtotal + tax;

  const { getCompanyInvoicingMode } = await import("./mode");
  const modeInfo = await getCompanyInvoicingMode(companyId, admin);
  // Fechas por hora de Madrid, no UTC: entre las 22:00 y las 24:00 UTC en
  // España ya es el día siguiente, y una factura fechada el 31 de agosto
  // cuando aquí es 1 de septiembre cae en el trimestre de IVA equivocado.
  const issueDate = madridDateKey(new Date());
  const dueDate =
    input.due_date ??
    madridDateKey(new Date(Date.now() + (fiscal.invoice_default_due_days ?? 30) * 86400000));

  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
    customer_id: input.customer_id ?? null,
    financier_id: input.financier_id ?? null,
    contract_id: input.contract_id ?? null,
    kind,
    series_id: series.id,
    number: numbering.number,
    fiscal_year: numbering.fiscal_year,
    full_reference: numbering.full_reference,
    status: "draft",
    customer_fiscal_snapshot: recipientSnapshot,
    company_fiscal_snapshot: fiscal,
    subtotal_cents: subtotal,
    tax_cents: tax,
    total_cents: total,
    withholdings_cents: 0,
    issue_date: issueDate,
    due_date: dueDate,
    corrects_invoice_id: input.corrects_invoice_id ?? null,
    notes: input.notes ?? null,
    maintenance_contract_id: input.maintenance_contract_id ?? null,
    billing_period: input.billing_period ?? null,
  };
  if (modeInfo.mode === "verifactu") {
    insertPayload.customer_snapshot = recipientSnapshot;
    insertPayload.tax_total_cents = tax;
    insertPayload.invoice_type = "F1";
    insertPayload.due_at = dueDate;
    insertPayload.operation_at = issueDate;
  }

  // INSERT defensivo: si financier_id / maintenance_contract_id /
  // billing_period no existen en cache (migración pendiente), los quitamos
  // y reintentamos para no romper en entornos viejos.
  let inv = await admin.from("invoices").insert(insertPayload).select("id").single();
  if (
    inv.error &&
    /financier_id|maintenance_contract_id|billing_period|schema cache|Could not find/i.test(
      inv.error.message ?? "",
    )
  ) {
    delete insertPayload.financier_id;
    delete insertPayload.maintenance_contract_id;
    delete insertPayload.billing_period;
    inv = await admin.from("invoices").insert(insertPayload).select("id").single();
  }
  if (inv.error) throw new Error(inv.error.message);
  const invoiceId = (inv.data as { id: string }).id;

  const { error: linesErr } = await admin.from("invoice_lines").insert(
    input.lines.map((l, idx) => {
      const t = calcLineTotals(l);
      return {
        invoice_id: invoiceId,
        company_id: companyId,
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
  if (linesErr) {
    // Una factura numerada y sin líneas es peor que ninguna: se borra el
    // borrador. El número queda quemado, que es lo correcto con AEAT (un
    // hueco justificado antes que una factura vacía emitida).
    await admin.from("invoices").delete().eq("id", invoiceId);
    throw new Error(linesErr.message);
  }

  await admin.from("events").insert({
    company_id: companyId,
    subject_type: "contract",
    subject_id: input.contract_id ?? invoiceId,
    kind: "invoice.created",
    payload: { invoice_id: invoiceId, full_reference: numbering.full_reference },
    actor_user_id: actorUserId,
  });

  return { id: invoiceId, full_reference: numbering.full_reference };
}

/**
 * Reparto base/IVA de una cuota mensual.
 *
 * La semántica del precio depende del destinatario, igual que en `pickPrice`:
 *   · particular            → la cuota ya lleva el IVA dentro → se desglosa
 *   · empresa o autónomo    → la cuota es BASE imponible      → se suma el IVA
 *
 * El bucle de ajuste corrige el céntimo del redondeo para que
 * base + IVA == cuota exacta en el caso "IVA incluido".
 */
export function splitMonthlyFee(
  monthlyCents: number,
  ivaPercent: number,
  recipient: { party_kind?: "individual" | "company" | null; is_autonomo?: boolean | null } | null,
): { base_cents: number; tax_cents: number; total_cents: number } {
  const taxOf = (b: number) => Math.round((b * ivaPercent) / 100);
  if (isBusinessParty(recipient)) {
    const tax = taxOf(monthlyCents);
    return { base_cents: monthlyCents, tax_cents: tax, total_cents: monthlyCents + tax };
  }
  let base = Math.round(monthlyCents / (1 + ivaPercent / 100));
  for (let k = 0; k < 3 && base + taxOf(base) !== monthlyCents; k++) {
    base += base + taxOf(base) < monthlyCents ? 1 : -1;
  }
  return { base_cents: base, tax_cents: monthlyCents - base, total_cents: monthlyCents };
}

/**
 * Factura de la cuota mensual de un contrato de alquiler/renting.
 * Camino único: lo usa el cron diario y cualquier otro sitio que necesite
 * emitir la mensualidad sin sesión de usuario.
 */
export async function createContractMonthlyInvoice(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  companyId: string;
  contract: { id: string; customer_id: string; monthly_cents: number; reference_code?: string | null };
  /** Etiqueta del periodo, "2026-09". */
  monthLabel: string;
  /** Vencimiento explícito (el cron usa el último día del mes). */
  dueDate?: string | null;
  fiscal?: FiscalSettings;
  actorUserId?: string | null;
}): Promise<{ id: string; full_reference: string; total_cents: number }> {
  const { admin, companyId, contract, monthLabel } = args;
  const fiscal = args.fiscal ?? (await loadFiscalSettings(admin, companyId));
  const iva = fiscal.invoice_default_iva;

  const { data: cust } = await admin
    .from("customers")
    .select("id, party_kind, is_autonomo")
    .eq("id", contract.customer_id)
    .eq("company_id", companyId)
    .maybeSingle();

  const split = splitMonthlyFee(
    contract.monthly_cents,
    iva,
    cust as { party_kind?: "individual" | "company" | null; is_autonomo?: boolean | null } | null,
  );

  const created = await createInvoiceCore({
    admin,
    companyId,
    actorUserId: args.actorUserId ?? null,
    fiscal,
    input: {
      customer_id: contract.customer_id,
      contract_id: contract.id,
      kind: "invoice",
      due_date: args.dueDate ?? null,
      billing_period: monthLabel,
      notes: `Mensualidad ${monthLabel} contrato ${contract.reference_code ?? contract.id.slice(0, 8)}`,
      lines: [
        {
          description: `Cuota mensual · ${monthLabel}`,
          quantity: 1,
          unit_price_cents: split.base_cents,
          discount_percent: 0,
          tax_rate_percent: iva,
        },
      ],
    },
  });
  return { ...created, total_cents: split.total_cents };
}
