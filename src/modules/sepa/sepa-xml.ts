"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

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
    const { data: paysRaw } = await admin
      .from("contract_payments")
      .select(
        "id, contract_id, amount_cents, concept, status, method, sepa_batch_id, contracts!inner(customer_id, company_id)",
      )
      .eq("method", "direct_debit")
      .eq("status", "pending")
      .is("sepa_batch_id", null)
      .eq("contracts.company_id", session.company_id);
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
      .select("customer_id, iban, sepa_mandate_id, sepa_mandate_signed_at, account_holder_name, is_primary, is_validated")
      .in("customer_id", customerIds)
      .order("is_primary", { ascending: false });
    type BK = {
      customer_id: string;
      iban: string;
      sepa_mandate_id: string | null;
      sepa_mandate_signed_at: string | null;
      account_holder_name: string | null;
      is_primary: boolean;
      is_validated: boolean | null;
    };
    const bankMap = new Map<string, BK>();
    for (const b of ((banks ?? []) as BK[])) {
      if (!bankMap.has(b.customer_id)) bankMap.set(b.customer_id, b);
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
      if (!bank?.iban || /^ES00/i.test(bank.iban)) {
        skipped.push(`${cust.legal_name ?? cust.first_name ?? cust.id}: IBAN no disponible o ES00`);
        continue;
      }
      if (!bank.sepa_mandate_id) {
        skipped.push(`${cust.legal_name ?? cust.first_name ?? cust.id}: sin mandato SEPA firmado`);
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
        customer_iban: cleanIban(bank.iban),
        amount_cents: p.amount_cents,
        concept: p.concept,
        mandate_id: bank.sepa_mandate_id,
        mandate_date: bank.sepa_mandate_signed_at ?? new Date().toISOString().slice(0, 10),
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
    const msgId = `REM-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const creationDate = now.toISOString();
    const collectionDate = now.toISOString().slice(0, 10);
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
          <FinInstnId/>
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
        <FinInstnId/>
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

    // Persistimos el batch y lockeamos los pagos incluidos (idempotencia).
    try {
      const { data: created } = await admin
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
      const batchId = (created as { id: string } | null)?.id ?? null;
      if (batchId) {
        const paymentIds = rows.map((r) => r.contract_payment_id);
        await admin
          .from("contract_payments")
          .update({ sepa_batch_id: batchId })
          .in("id", paymentIds);
      }
    } catch (e) {
      console.error("[sepa-xml] batch persistence failed:", e);
      // No-bloqueante: el XML se devuelve igual; el usuario sabe que
      // tendrá que controlar manualmente los duplicados si genera otra
      // vez antes de aplicar la migración.
    }

    const filename = `remesa-sepa-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${rows.length}tx.xml`;
    return { ok: true, xml, filename, transactions: rows.length, total_cents: totalCents };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
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
    const { error: e1 } = await admin
      .from("sepa_batches")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "open");
    if (e1) return { ok: false, error: e1.message };
    const { data: updRows } = await admin
      .from("contract_payments")
      .update({ status: "collected_pending_validation", collected_at: new Date().toISOString() })
      .eq("sepa_batch_id", batchId)
      .select("id");
    const updated = ((updRows ?? []) as Array<{ id: string }>).length;
    return { ok: true, updated_payments: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
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
    await admin
      .from("sepa_batches")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_reason: reason,
      })
      .eq("id", batchId)
      .eq("company_id", session.company_id)
      .eq("status", "open");
    await admin
      .from("contract_payments")
      .update({ sepa_batch_id: null })
      .eq("sepa_batch_id", batchId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
