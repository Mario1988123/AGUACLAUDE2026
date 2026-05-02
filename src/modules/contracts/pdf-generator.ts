"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDoc,
  drawHeader,
  drawSection,
  drawKeyValue,
  drawTable,
  drawText,
  drawHr,
  fmtEur,
  fmtDate,
  COLORS,
} from "@/shared/lib/pdf/primitives";
import { getContract, getContractItems, getContractPayments } from "./actions";

const PLAN_LABEL = { cash: "Contado", renting: "Renting", rental: "Alquiler" } as const;

/**
 * PDF de contrato — versión BÁSICA / PROVISIONAL.
 * APARCADO: el usuario adjuntará un ejemplo real cuando lo tenga listo y se
 * sustituirá por el diseño definitivo. No invertir tiempo en este layout.
 */
export async function generateContractPdf(contractId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  const [contract, items, payments] = await Promise.all([
    getContract(contractId),
    getContractItems(contractId),
    getContractPayments(contractId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [{ data: company }, { data: customer }] = await Promise.all([
    supabase
      .from("companies")
      .select("legal_name, trade_name, tax_id")
      .eq("id", session.company_id)
      .single(),
    supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
      .eq("id", contract.customer_id)
      .single(),
  ]);
  const co = (company ?? {}) as { legal_name?: string | null; trade_name?: string | null; tax_id?: string | null };
  const cu = (customer ?? {}) as {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tax_id?: string | null;
  };
  const customerName =
    cu.party_kind === "company"
      ? cu.trade_name || cu.legal_name || "—"
      : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() || "—";

  const doc = await newDoc();
  drawHeader(doc, `Contrato ${contract.reference_code ?? ""}`.trim(), co.trade_name || co.legal_name || "Empresa");

  drawText(
    doc,
    "[Documento provisional — pendiente de plantilla definitiva del cliente]",
    { size: 9, color: COLORS.muted },
  );

  drawSection(doc, "Cliente");
  drawKeyValue(doc, "Nombre", customerName);
  if (cu.tax_id) drawKeyValue(doc, "DNI/CIF", cu.tax_id);

  drawSection(doc, "Condiciones");
  drawKeyValue(doc, "Modalidad", PLAN_LABEL[contract.plan_type] ?? contract.plan_type);
  if (contract.duration_months) drawKeyValue(doc, "Duración", `${contract.duration_months} meses`);
  if (contract.signed_at) drawKeyValue(doc, "Firmado", fmtDate(contract.signed_at));

  drawSection(doc, "Equipos");
  drawTable(
    doc,
    ["Producto", "Cant.", "Precio", "Subtotal"],
    items.map((it) => ({
      cells: [
        it.product_name_snapshot,
        String(it.quantity),
        fmtEur(it.unit_price_cents),
        fmtEur(it.unit_price_cents * it.quantity),
      ],
    })),
    [260, 60, 90, 90],
  );

  drawHr(doc);
  drawText(doc, `TOTAL: ${fmtEur(contract.total_cash_cents)}`, { bold: true, size: 14, color: COLORS.brand });
  if (contract.monthly_cents) drawText(doc, `Cuota mensual: ${fmtEur(contract.monthly_cents)}`, { size: 11 });

  if (payments.length > 0) {
    drawSection(doc, "Plan de pagos");
    drawTable(
      doc,
      ["Concepto", "Importe"],
      payments.map((p) => ({ cells: [p.concept, fmtEur(p.amount_cents)] })),
      [350, 110],
    );
  }

  drawSection(doc, "Firmas");
  drawHr(doc, 30);
  drawText(doc, "_________________________________", { size: 10 });
  drawText(doc, "Firma cliente", { size: 9, color: COLORS.muted });
  drawHr(doc, 20);
  drawText(doc, "_________________________________", { size: 10 });
  drawText(doc, "Firma empresa", { size: 9, color: COLORS.muted });

  return await doc.pdf.save();
}
