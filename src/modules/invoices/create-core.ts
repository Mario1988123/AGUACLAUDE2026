import "server-only";

import { loadFiscalSettings, type FiscalSettings } from "@/modules/config/fiscal/load";
import { madridDateKey } from "@/shared/lib/format-date";
import type { InvoiceKind, InvoiceLine } from "./actions";
import {
  calcularLinea,
  esEmpresaOAutonomo,
  precioUnitarioAGuardar,
  splitMonthlyFee,
  totalesFactura,
  validarLineasFactura,
} from "./importes";

export { splitMonthlyFee } from "./importes";

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

/**
 * Totales de una línea. Se mantiene el nombre por compatibilidad; la fórmula
 * vive en ./importes (redondeo por magnitud, IVA incluido, importes fijos).
 */
export function calcLineTotals(line: InvoiceLine) {
  return calcularLinea(line);
}

/** Versión mínima del esquema de facturación que necesitan las rectificativas. */
const VERSION_ESQUEMA_RECTIFICATIVAS = 20261002;

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
}: CreateInvoiceCoreArgs): Promise<{ id: string; full_reference: string; total_cents: number }> {
  // ── 1. Validaciones ANTES de numerar ────────────────────────────────────
  // Todo lo que pueda fallar se comprueba antes de allocate_next_invoice_number:
  // un error después del número deja un hueco en la serie (I39, C4).
  if (!input.lines || input.lines.length === 0) {
    throw new Error("Añade al menos una línea");
  }
  if (!input.customer_id && !input.financier_id) {
    throw new Error("La factura necesita un destinatario (customer_id o financier_id)");
  }
  const kind: InvoiceKind = input.kind ?? "invoice";
  const errLineas = validarLineasFactura(input.lines, kind);
  if (errLineas) throw new Error(errLineas);
  if (kind === "credit_note") {
    if (!input.corrects_invoice_id) {
      throw new Error("Una rectificativa tiene que indicar la factura que rectifica");
    }
    // Las líneas negativas necesitan la migración 20261002130100 (CHECK
    // quantity <> 0). Sin ella el insert de líneas fallaría DESPUÉS de numerar.
    const { data: ver, error: verErr } = await admin.rpc("facturacion_esquema_version");
    if (verErr || Number(ver) < VERSION_ESQUEMA_RECTIFICATIVAS) {
      throw new Error(
        "Las rectificativas necesitan aplicar la migración de facturación del 02-10-2026. No se ha creado nada ni se ha gastado ningún número.",
      );
    }
  }

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
    if (!cust) throw new Error("Cliente no encontrado en tu empresa");
    const { data: addr } = await admin
      .from("addresses")
      .select("street, street_number, postal_code, city, province")
      .eq("customer_id", input.customer_id)
      .eq("company_id", companyId)
      .eq("is_primary", true)
      .maybeSingle();
    recipientSnapshot = { ...(cust ?? {}), address: addr ?? null };
  }

  const totales = totalesFactura(input.lines);
  if (kind === "credit_note" && totales.total_cents >= 0) {
    throw new Error("Una rectificativa por diferencias tiene que tener total negativo");
  }
  if (kind !== "credit_note" && totales.total_cents < 0) {
    throw new Error("El total de la factura no puede ser negativo");
  }

  const { getCompanyInvoicingMode } = await import("./mode");
  const modeInfo = await getCompanyInvoicingMode(companyId, admin);

  // ── 2. Numeración (a partir de aquí un fallo deja hueco) ────────────────
  const series = await getOrSeedSeries(admin, companyId, kind);
  const numbering = await allocateInvoiceNumber(admin, series);

  // Fechas por hora de Madrid, no UTC: entre las 22:00 y las 24:00 UTC en
  // España ya es el día siguiente, y una factura fechada el 31 de agosto
  // cuando aquí es 1 de septiembre cae en el trimestre de IVA equivocado.
  const issueDate = madridDateKey(new Date());
  const dueDate =
    kind === "credit_note"
      ? issueDate
      : input.due_date ??
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
    subtotal_cents: totales.subtotal_cents,
    tax_cents: totales.tax_cents,
    total_cents: totales.total_cents,
    withholdings_cents: 0,
    issue_date: issueDate,
    due_date: dueDate,
    corrects_invoice_id: input.corrects_invoice_id ?? null,
    notes: input.notes ?? null,
    maintenance_contract_id: input.maintenance_contract_id ?? null,
    billing_period: input.billing_period ?? null,
  };
  if (kind === "credit_note") {
    insertPayload.is_rectificative = true;
    insertPayload.rectifies_invoice_id = input.corrects_invoice_id ?? null;
    insertPayload.rectification_reason = input.notes ?? null;
  }
  if (modeInfo.mode === "verifactu") {
    insertPayload.customer_snapshot = recipientSnapshot;
    insertPayload.tax_total_cents = totales.tax_cents;
    // [decide] Rectificativa = R1 (error fundado en derecho / art. 80 LIVA),
    // por diferencias. Pendiente de confirmar (pregunta de negocio 3). Hoy
    // ninguna empresa está en modo VeriFactu, así que no se envía nada.
    insertPayload.invoice_type = kind === "credit_note" ? "R1" : "F1";
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
  if (inv.error) {
    if (/uniq_invoices_contract_period/i.test(inv.error.message ?? "")) {
      throw new Error(`Ya existe la factura de ese periodo (${input.billing_period}) para este contrato`);
    }
    throw new Error(inv.error.message);
  }
  const invoiceId = (inv.data as { id: string }).id;

  const { error: linesErr } = await admin.from("invoice_lines").insert(
    input.lines.map((l, idx) => {
      const t = calcularLinea(l);
      return {
        invoice_id: invoiceId,
        company_id: companyId,
        product_id: l.product_id ?? null,
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: precioUnitarioAGuardar(l, t),
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

  return { id: invoiceId, full_reference: numbering.full_reference, total_cents: totales.total_cents };
}

/**
 * La cuota de este contrato no se factura al cliente (no es un error de
 * datos): renting con financiera, donde la cuota la cobra la financiera.
 */
export class CuotaNoFacturableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CuotaNoFacturableError";
  }
}

interface ContratoCuota {
  id: string;
  customer_id: string;
  monthly_cents: number;
  plan_type: string | null;
  financier_id: string | null;
  reference_code: string | null;
  customer_snapshot: Record<string, unknown> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cargarContratoCuota(admin: any, companyId: string, contractId: string): Promise<ContratoCuota> {
  const { data, error } = await admin
    .from("contracts")
    .select("id, customer_id, monthly_cents, plan_type, financier_id, reference_code, customer_snapshot")
    .eq("id", contractId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Contrato no encontrado en la empresa");
  return data as ContratoCuota;
}

/**
 * Destinatario fiscal con el que se FIRMÓ el contrato (I30): el tipo de
 * cliente se congela en `contracts.customer_snapshot` al crear el contrato,
 * que es cuando se eligió precio con o sin IVA. Si un particular pasa luego a
 * empresa, su cuota firmada (IVA incluido) no sube un 21 %. Solo si el
 * contrato no tiene snapshot se mira la ficha actual del cliente.
 */
async function destinatarioFirmado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  c: ContratoCuota,
): Promise<{ party_kind?: string | null; is_autonomo?: boolean | null } | null> {
  const snap = c.customer_snapshot;
  if (snap && typeof snap.party_kind === "string") {
    return {
      party_kind: snap.party_kind as string,
      is_autonomo: (snap.is_autonomo as boolean | null | undefined) ?? null,
    };
  }
  const { data: cust } = await admin
    .from("customers")
    .select("id, party_kind, is_autonomo")
    .eq("id", c.customer_id)
    .eq("company_id", companyId)
    .maybeSingle();
  return (cust as { party_kind?: string | null; is_autonomo?: boolean | null } | null) ?? null;
}

/**
 * ¿Los precios de este contrato llevan el IVA dentro? Regla de `pickPrice`:
 * particular → sí; empresa/autónomo → no (base imponible).
 * OJO: si a una empresa se le aplicó el precio de particular porque el
 * producto no tenía precio de empresa, el contrato no lo recuerda y aquí se
 * trata como base. Ver informe (pregunta de negocio pendiente).
 */
export async function preciosContratoIncluyenIva(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  contractId: string,
): Promise<boolean> {
  const c = await cargarContratoCuota(admin, companyId, contractId);
  return !esEmpresaOAutonomo(await destinatarioFirmado(admin, companyId, c));
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
  const { admin, companyId, monthLabel } = args;
  const fiscal = args.fiscal ?? (await loadFiscalSettings(admin, companyId));
  const iva = fiscal.invoice_default_iva;

  // Se relee el contrato: el snapshot del cliente y la financiera mandan.
  const c = await cargarContratoCuota(admin, companyId, args.contract.id);
  if (c.plan_type === "renting" && c.financier_id) {
    // Decisión del 14-05-2026: en renting con financiera se factura a la
    // financiera, no al cliente. Pendiente de confirmar quién cobra la
    // cuota (pregunta de negocio 2); mientras, no se le cobra al cliente.
    throw new CuotaNoFacturableError(
      `Contrato ${c.reference_code ?? c.id.slice(0, 8)}: renting con financiera, la cuota no se factura al cliente`,
    );
  }
  const monthly = args.contract.monthly_cents;
  const destinatario = await destinatarioFirmado(admin, companyId, c);
  const ivaIncluido = !esEmpresaOAutonomo(destinatario);
  const split = splitMonthlyFee(monthly, iva, destinatario);

  const created = await createInvoiceCore({
    admin,
    companyId,
    actorUserId: args.actorUserId ?? null,
    fiscal,
    input: {
      customer_id: c.customer_id,
      contract_id: c.id,
      kind: "invoice",
      due_date: args.dueDate ?? null,
      billing_period: monthLabel,
      notes: `Mensualidad ${monthLabel} contrato ${c.reference_code ?? c.id.slice(0, 8)}`,
      lines: [
        {
          description: `Cuota mensual · ${monthLabel}`,
          quantity: 1,
          // Particular: se pasa la cuota con IVA dentro y la línea se
          // desglosa respetando el total (100,00 € = 82,64 + 17,36).
          unit_price_cents: ivaIncluido ? monthly : split.base_cents,
          iva_incluido: ivaIncluido,
          discount_percent: 0,
          tax_rate_percent: iva,
        },
      ],
    },
  });
  // Lo cobrado = lo facturado, siempre: se devuelve el total REAL guardado.
  return { id: created.id, full_reference: created.full_reference, total_cents: created.total_cents };
}

export type ResultadoCuotaMensual =
  | { estado: "creada"; invoice_id: string; contract_payment_id: string; wallet_entry_id: string; total_cents: number }
  | { estado: "ya_existia" }
  | { estado: "omitida"; motivo: string };

/**
 * Cuota mensual COMPLETA de un contrato: factura + contract_payment +
 * wallet_entry, con el wallet enlazado a la factura (invoice_id). Es lo que
 * deben llamar el cron diario y el botón "Generar cuotas" para no
 * contradecirse (C3, I28).
 *
 * Sin invoice_id en el wallet, al validar el cobro aparecía en "pendientes de
 * facturar" y el botón "Facturar" creaba una SEGUNDA factura del mismo mes,
 * mientras la del cron seguía sin cobrar y acababa en recordatorios de
 * impago.
 *
 * Idempotente por (contrato, billing_period): si ya hay factura no anulada de
 * ese periodo o un cobro de cuota de ese mes, no hace nada. Supabase no da
 * transacciones de cliente: si falla un paso, deshace lo creado (la factura
 * borrada deja hueco en la serie, como ya pasaba).
 */
export async function registrarCuotaMensualContrato(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  companyId: string;
  contract: { id: string; customer_id: string; monthly_cents: number; reference_code?: string | null };
  /** "2026-10" (mes de Madrid). */
  monthLabel: string;
  dueDate?: string | null;
  fiscal?: FiscalSettings;
  actorUserId?: string | null;
}): Promise<ResultadoCuotaMensual> {
  const { admin, companyId, contract, monthLabel } = args;
  if (!/^\d{4}-\d{2}$/.test(monthLabel)) throw new Error(`Periodo no válido: ${monthLabel}`);
  if (!Number.isInteger(contract.monthly_cents) || contract.monthly_cents <= 0) {
    return { estado: "omitida", motivo: "sin cuota mensual" };
  }

  const { count: yaFactura, error: e1 } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("contract_id", contract.id)
    .eq("kind", "invoice")
    .eq("billing_period", monthLabel)
    .not("status", "in", "(cancelled,void)")
    .is("deleted_at", null);
  if (e1) throw new Error(e1.message);
  if ((yaFactura ?? 0) > 0) return { estado: "ya_existia" };
  const { count: yaCobro, error: e2 } = await admin
    .from("contract_payments")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contract.id)
    .ilike("concept", `Cuota mensual%${monthLabel}%`);
  if (e2) throw new Error(e2.message);
  if ((yaCobro ?? 0) > 0) return { estado: "ya_existia" };

  let inv: { id: string; full_reference: string; total_cents: number };
  try {
    inv = await createContractMonthlyInvoice(args);
  } catch (e) {
    if (e instanceof CuotaNoFacturableError) return { estado: "omitida", motivo: e.message };
    throw e;
  }

  const { data: cpRow, error: cpErr } = await admin
    .from("contract_payments")
    .insert({
      company_id: companyId,
      contract_id: contract.id,
      concept: `Cuota mensual · ${monthLabel}`,
      amount_cents: inv.total_cents,
      method: "direct_debit",
      moment: "periodic",
      status: "pending",
    })
    .select("id")
    .single();
  if (cpErr) {
    await admin.from("invoice_lines").delete().eq("invoice_id", inv.id);
    await admin.from("invoices").delete().eq("id", inv.id);
    throw new Error(`Cobro de la cuota: ${cpErr.message}`);
  }
  const cpId = (cpRow as { id: string }).id;

  const { data: weRow, error: weErr } = await admin
    .from("wallet_entries")
    .insert({
      company_id: companyId,
      contract_id: contract.id,
      contract_payment_id: cpId,
      customer_id: contract.customer_id,
      invoice_id: inv.id,
      concept: `Cuota mensual ${monthLabel}`,
      amount_cents: inv.total_cents,
      method: "direct_debit",
      status: "pending",
    })
    .select("id")
    .single();
  if (weErr) {
    await admin.from("contract_payments").delete().eq("id", cpId);
    await admin.from("invoice_lines").delete().eq("invoice_id", inv.id);
    await admin.from("invoices").delete().eq("id", inv.id);
    throw new Error(`Wallet de la cuota: ${weErr.message}`);
  }
  const weId = (weRow as { id: string }).id;
  await admin.from("contract_payments").update({ wallet_entry_id: weId }).eq("id", cpId);

  return {
    estado: "creada",
    invoice_id: inv.id,
    contract_payment_id: cpId,
    wallet_entry_id: weId,
    total_cents: inv.total_cents,
  };
}
