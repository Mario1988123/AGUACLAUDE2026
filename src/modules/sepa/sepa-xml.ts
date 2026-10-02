"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { madridDateKey } from "@/shared/lib/format-date";
import { fechaCobroSepa } from "./fechas";

/**
 * Genera un archivo SEPA Direct Debit en formato XML pain.008.001.08
 * (versión actual estándar EPC AOS 2023). El usuario lo descarga y lo
 * sube directamente al portal de su banco para procesar la remesa.
 *
 * Este flujo es alternativo a GoCardless: la empresa no necesita una
 * cuenta GoCardless si tiene Acuerdo CSB-19/SEPA con su banco.
 */

export type SepaXmlResult =
  | { ok: true; xml: string; filename: string; transactions: number; total_cents: number }
  | { ok: false; error: string };

interface RemesaRow {
  contract_payment_id: string;
  customer_id: string;
  customer_name: string;
  customer_address: string;
  customer_iban: string;
  amount_cents: number;
  concept: string;
  mandate_id: string; // referencia única del mandato SEPA
  mandate_date: string; // fecha firma mandato
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

function eurFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Devuelve XML pain.008.001.08 listo para que el usuario lo descargue
 * y lo suba al portal de su banco. NO valida el IBAN del acreedor —
 * eso lo verifica el banco al procesar.
 */
export async function generateSepaXmlForPendingDebits(): Promise<SepaXmlResult> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (
      !session.is_superadmin &&
      !session.roles.includes("company_admin")
    ) {
      return { ok: false, error: "Solo el admin de empresa puede generar la remesa" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Datos fiscales del acreedor (la empresa)
    const { data: cs } = await admin
      .from("company_settings")
      .select(
        "fiscal_legal_name, fiscal_tax_id, fiscal_address, fiscal_postal_code, fiscal_city, sepa_creditor_id, fiscal_iban",
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const cset = cs as {
      fiscal_legal_name: string | null;
      fiscal_tax_id: string | null;
      fiscal_address: string | null;
      fiscal_postal_code: string | null;
      fiscal_city: string | null;
      sepa_creditor_id: string | null;
      fiscal_iban: string | null;
    } | null;
    if (!cset?.sepa_creditor_id) {
      return {
        ok: false,
        error:
          "Falta el identificador de acreedor SEPA (CID). Configúralo en /configuracion/fiscal antes de generar remesas.",
      };
    }
    if (!cset?.fiscal_iban) {
      return {
        ok: false,
        error: "Falta el IBAN fiscal de la empresa en /configuracion/fiscal.",
      };
    }

    // Idempotencia (decisión 2026-05-20): si ya hay un batch SEPA abierto
    // para esta empresa, devolvemos su XML existente en vez de regenerar
    // con datos distintos. El admin tiene que marcarlo como enviado o
    // cancelarlo antes de generar otro.
    try {
      const { data: openBatch } = await admin
        .from("sepa_batches")
        .select("id, msg_id, xml, total_cents, num_transactions")
        .eq("company_id", session.company_id)
        .eq("status", "open")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openBatch) {
        const b = openBatch as {
          id: string;
          msg_id: string;
          xml: string;
          total_cents: number;
          num_transactions: number;
        };
        return {
          ok: true,
          xml: b.xml,
          filename: `remesa-sepa-existente-${b.msg_id}.xml`,
          transactions: b.num_transactions,
          total_cents: b.total_cents,
        };
      }
    } catch {
      /* fail-soft: si la tabla no está migrada, sigue al flujo normal */
    }

    // Cobros pendientes con método direct_debit (NO ya lockeados en otro batch)
    // C6: solo de contratos VIVOS. Antes no se miraba el estado del contrato
    // y se domiciliaba a clientes con el contrato cancelado.
    // [decide] `completed` entra: un alquiler finalizado puede deber la
    // cuota ya facturada de su último mes. Cancelado o borrado, nunca.
    const { data: paysRaw, error: paysErr } = await admin
      .from("contract_payments")
      .select(
        "id, contract_id, amount_cents, concept, status, method, sepa_batch_id, contracts!inner(customer_id, company_id, status, deleted_at)",
      )
      .eq("company_id", session.company_id)
      .eq("method", "direct_debit")
      .eq("status", "pending")
      .gt("amount_cents", 0)
      .is("sepa_batch_id", null)
      .eq("contracts.company_id", session.company_id)
      .in("contracts.status", ["signed", "active", "completed"])
      .is("contracts.deleted_at", null);
    if (paysErr) return { ok: false, error: paysErr.message };
    type CP = {
      id: string;
      contract_id: string;
      amount_cents: number;
      concept: string;
      contracts: { customer_id: string };
    };
    const pays = (paysRaw ?? []) as CP[];
    if (pays.length === 0) {
      return {
        ok: false,
        error: "No hay cobros pendientes por domiciliación SEPA.",
      };
    }

    // Para cada pago, resolver IBAN del cliente + datos
    const customerIds = Array.from(new Set(pays.map((p) => p.contracts.customer_id)));
    const { data: customers } = await admin
      .from("customers")
      .select(
        "id, legal_name, trade_name, first_name, last_name, party_kind, tax_id",
      )
      .in("id", customerIds);
    type CR = {
      id: string;
      legal_name: string | null;
      trade_name: string | null;
      first_name: string | null;
      last_name: string | null;
      party_kind: "individual" | "company";
      tax_id: string | null;
    };
    const custMap = new Map<string, CR>();
    for (const c of ((customers ?? []) as CR[])) custMap.set(c.id, c);

    const { data: banks } = await admin
      .from("customer_bank_accounts")
      // customer_bank_accounts NO tiene columnas de mandato: el mandato vive en
      // la tabla sepa_mandates (umr + signed_at). Pedirlas aquí tumbaba el
      // select y la remesa salía siempre vacía ("sin cuenta bancaria").
      .select("customer_id, iban, account_holder_name, is_primary, is_validated")
      .in("customer_id", customerIds)
      .order("is_primary", { ascending: false });
    type BK = {
      customer_id: string;
      iban: string;
      account_holder_name: string | null;
      is_primary: boolean;
      is_validated: boolean | null;
    };
    const bankMap = new Map<string, BK>();
    for (const b of ((banks ?? []) as BK[])) {
      if (!bankMap.has(b.customer_id)) bankMap.set(b.customer_id, b);
    }

    // Mandato SEPA vigente: ACTIVO (firmado), no cancelado y con fecha de
    // firma. Se prefiere el mandato del propio contrato; si no, el más
    // reciente del cliente.
    const { data: mandates } = await admin
      .from("sepa_mandates")
      .select("customer_id, contract_id, umr, signed_at, status, cancelled_at, debtor_iban")
      .eq("company_id", session.company_id)
      .in("customer_id", customerIds)
      .eq("status", "active")
      .is("cancelled_at", null)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false });
    type MD = {
      customer_id: string;
      contract_id: string | null;
      umr: string | null;
      signed_at: string | null;
      status: string | null;
      debtor_iban: string | null;
    };
    const mandateMap = new Map<string, MD>();
    const mandateByContract = new Map<string, MD>();
    for (const m of ((mandates ?? []) as MD[])) {
      if (!mandateMap.has(m.customer_id)) mandateMap.set(m.customer_id, m);
      if (m.contract_id && !mandateByContract.has(m.contract_id)) mandateByContract.set(m.contract_id, m);
    }

    const { data: addresses } = await admin
      .from("addresses")
      .select("customer_id, street, street_number, postal_code, city, is_primary")
      .in("customer_id", customerIds)
      .order("is_primary", { ascending: false });
    type AD = {
      customer_id: string;
      street: string | null;
      street_number: string | null;
      postal_code: string | null;
      city: string | null;
      is_primary: boolean;
    };
    const addrMap = new Map<string, AD>();
    for (const a of ((addresses ?? []) as AD[])) {
      if (!addrMap.has(a.customer_id)) addrMap.set(a.customer_id, a);
    }

    const rows: RemesaRow[] = [];
    const skipped: string[] = [];
    for (const p of pays) {
      const cust = custMap.get(p.contracts.customer_id);
      const bank = bankMap.get(p.contracts.customer_id);
      const addr = addrMap.get(p.contracts.customer_id);
      if (!cust) continue;
      const mandate =
        mandateByContract.get(p.contract_id) ?? mandateMap.get(p.contracts.customer_id);
      if (!mandate?.umr || !mandate.signed_at) {
        skipped.push(`${cust.legal_name ?? cust.first_name ?? cust.id}: sin mandato SEPA firmado`);
        continue;
      }
      // El IBAN autorizado es el del MANDATO; la cuenta del cliente solo si
      // el mandato no lo guarda.
      const iban = mandate.debtor_iban || bank?.iban || "";
      if (!iban || /^ES00/i.test(iban)) {
        skipped.push(`${cust.legal_name ?? cust.first_name ?? cust.id}: IBAN no disponible o ES00`);
        continue;
      }
      const name =
        cust.party_kind === "company"
          ? cust.trade_name || cust.legal_name || ""
          : `${cust.first_name ?? ""} ${cust.last_name ?? ""}`.trim();
      const addressLine = addr
        ? `${addr.street ?? ""} ${addr.street_number ?? ""}, ${addr.postal_code ?? ""} ${addr.city ?? ""}`.trim()
        : "";
      rows.push({
        contract_payment_id: p.id,
        customer_id: cust.id,
        customer_name: name,
        customer_address: addressLine,
        customer_iban: cleanIban(iban),
        amount_cents: p.amount_cents,
        concept: p.concept,
        mandate_id: mandate.umr,
        // Fecha REAL de firma del mandato (antes se inventaba "hoy").
        mandate_date: madridDateKey(mandate.signed_at),
      });
    }

    if (rows.length === 0) {
      return {
        ok: false,
        error:
          `No hay cobros con datos suficientes para remesar. ${skipped.length} omitidos. Revisa IBAN y mandatos SEPA de los clientes.`,
      };
    }

    const now = new Date();
    const hoyMadrid = madridDateKey(now);
    const msgId = `REM-${hoyMadrid.replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // ISODateTime sin milisegundos (los validadores de algunos bancos los rechazan).
    const creationDate = now.toISOString().slice(0, 19);
    // I23: D+2 hábiles TARGET2 desde hoy (Madrid), nunca hoy ni una fecha pasada.
    const collectionDate = fechaCobroSepa(hoyMadrid);
    const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
    const total = eurFromCents(totalCents);
    const numTx = rows.length;

    const txXml = rows
      .map((r, i) => {
        const endToEnd = `${msgId}-${String(i + 1).padStart(4, "0")}`;
        return `      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${esc(endToEnd)}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${eurFromCents(r.amount_cents)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${esc(r.mandate_id)}</MndtId>
            <DtOfSgntr>${esc(r.mandate_date.slice(0, 10))}</DtOfSgntr>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${esc(r.customer_name || "Cliente")}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id><IBAN>${esc(r.customer_iban)}</IBAN></Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>${esc(r.concept.slice(0, 140))}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(msgId)}</MsgId>
      <CreDtTm>${esc(creationDate)}</CreDtTm>
      <NbOfTxs>${numTx}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <InitgPty>
        <Nm>${esc(cset.fiscal_legal_name ?? "Empresa")}</Nm>
        <Id><OrgId><Othr><Id>${esc(cset.sepa_creditor_id)}</Id></Othr></OrgId></Id>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(msgId)}-PI</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${numTx}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>CORE</Cd></LclInstrm>
        <SeqTp>RCUR</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${esc(collectionDate)}</ReqdColltnDt>
      <Cdtr>
        <Nm>${esc(cset.fiscal_legal_name ?? "Empresa")}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id><IBAN>${esc(cleanIban(cset.fiscal_iban))}</IBAN></Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>
      </CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id><PrvtId><Othr>
          <Id>${esc(cset.sepa_creditor_id)}</Id>
          <SchmeNm><Prtry>SEPA</Prtry></SchmeNm>
        </Othr></PrvtId></Id>
      </CdtrSchmeId>
${txXml}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;

    // Persistimos el batch y bloqueamos los pagos ANTES de entregar el XML
    // (I23). Antes el XML se devolvía aunque fallara el guardado y el update
    // no comprobaba que el pago siguiera libre: dos clics daban dos remesas
    // con los mismos cobros. Ahora:
    //   · el índice único de batch `open` por empresa (migración
    //     20261002130100) impide dos remesas abiertas a la vez;
    //   · el update solo bloquea pagos con sepa_batch_id NULL y se comprueba
    //     que se bloquearon TODOS; si no, se deshace y no se entrega nada.
    const { data: created, error: batchErr } = await admin
      .from("sepa_batches")
      .insert({
        company_id: session.company_id,
        msg_id: msgId,
        status: "open",
        total_cents: totalCents,
        num_transactions: rows.length,
        xml,
        generated_by: session.user_id,
      })
      .select("id")
      .single();
    if (batchErr || !created) {
      return {
        ok: false,
        error: /uniq_sepa_batch_open/i.test(batchErr?.message ?? "")
          ? "Ya hay una remesa abierta: márcala como enviada o cancélala antes de generar otra."
          : `No se pudo guardar la remesa: ${batchErr?.message ?? "error desconocido"}`,
      };
    }
    const batchId = (created as { id: string }).id;
    const paymentIds = rows.map((r) => r.contract_payment_id);
    const { data: locked, error: lockErr } = await admin
      .from("contract_payments")
      .update({ sepa_batch_id: batchId })
      .in("id", paymentIds)
      .eq("company_id", session.company_id)
      .eq("status", "pending")
      .is("sepa_batch_id", null)
      .select("id");
    const nLocked = ((locked ?? []) as unknown[]).length;
    if (lockErr || nLocked !== paymentIds.length) {
      await admin
        .from("contract_payments")
        .update({ sepa_batch_id: null })
        .eq("sepa_batch_id", batchId);
      await admin.from("sepa_batches").delete().eq("id", batchId);
      return {
        ok: false,
        error: lockErr
          ? `No se pudieron reservar los cobros: ${lockErr.message}`
          : "Algunos cobros han cambiado mientras se generaba la remesa. Vuelve a generarla.",
      };
    }

    const filename = `remesa-sepa-${hoyMadrid.replace(/-/g, "")}-${rows.length}tx.xml`;
    return { ok: true, xml, filename, transactions: rows.length, total_cents: totalCents };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}


/**
 * Marca el batch SEPA como enviado al banco. Idealmente lo invoca un
 * admin tras subir el XML al portal bancario. Hace dos cosas:
 *   1. batch.status = "sent" + sent_at.
 *   2. Los contract_payments asociados pasan a "collected_pending_validation"
 *      (el banco aún tiene que procesar el cobro; cuando vuelva el extracto,
 *      el admin valida).
 */
export async function markSepaBatchSentAction(
  batchId: string,
): Promise<{ ok: true; updated_payments: number } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin puede marcar la remesa como enviada" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: enviada, error: e1 } = await admin
      .from("sepa_batches")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "open")
      .select("id");
    if (e1) return { ok: false, error: e1.message };
    if (((enviada ?? []) as unknown[]).length === 0) {
      return { ok: false, error: "La remesa no está abierta (ya enviada o cancelada)" };
    }
    const { data: updRows, error: e2 } = await admin
      .from("contract_payments")
      .update({ status: "collected_pending_validation", collected_at: new Date().toISOString() })
      .eq("sepa_batch_id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "pending")
      .select("id");
    if (e2) return { ok: false, error: e2.message };
    const updated = ((updRows ?? []) as Array<{ id: string }>).length;
    return { ok: true, updated_payments: updated };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Cancela un batch SEPA abierto (p. ej. el banco rechazó el XML).
 * Libera los pagos lockeados para que se puedan incluir en otra remesa.
 */
export async function cancelSepaBatchAction(
  batchId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin puede cancelar la remesa" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Solo una remesa ABIERTA se cancela y solo entonces se liberan sus
    // pagos (I23). Antes se liberaban también los de una remesa ya enviada
    // al banco, que así se volvían a domiciliar en la siguiente.
    const { data: cancelada, error: cErr } = await admin
      .from("sepa_batches")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_reason: reason,
      })
      .eq("id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "open")
      .select("id");
    if (cErr) return { ok: false, error: cErr.message };
    if (((cancelada ?? []) as unknown[]).length === 0) {
      return {
        ok: false,
        error: "Solo se puede cancelar una remesa abierta. Si ya se envió al banco, gestiona la devolución desde el banco.",
      };
    }
    const { error: relErr } = await admin
      .from("contract_payments")
      .update({ sepa_batch_id: null })
      .eq("sepa_batch_id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "pending");
    if (relErr) return { ok: false, error: relErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
