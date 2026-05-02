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
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  direct_debit: "Domiciliación",
  financing: "Financiera",
};
const MOMENT_LABEL: Record<string, string> = {
  on_signature: "Firma",
  on_installation: "Instalación",
  intermediate: "Intermedio",
  periodic: "Periódico",
};

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
      .select(
        "party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary",
      )
      .eq("id", contract.customer_id)
      .single(),
  ]);
  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const cu = (customer ?? {}) as {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tax_id?: string | null;
    email?: string | null;
    phone_primary?: string | null;
  };
  const customerName =
    cu.party_kind === "company"
      ? cu.trade_name || cu.legal_name || "—"
      : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() || "—";

  const doc = await newDoc();
  drawHeader(
    doc,
    `Contrato ${contract.reference_code ?? ""}`.trim(),
    `${co.trade_name || co.legal_name || "Empresa"}${co.tax_id ? ` · ${co.tax_id}` : ""}`,
  );

  drawSection(doc, "Cliente");
  drawKeyValue(doc, "Nombre", customerName);
  if (cu.tax_id) drawKeyValue(doc, "DNI/CIF", cu.tax_id);
  if (cu.email) drawKeyValue(doc, "Email", cu.email);
  if (cu.phone_primary) drawKeyValue(doc, "Teléfono", cu.phone_primary);

  drawSection(doc, "Condiciones");
  drawKeyValue(doc, "Modalidad", PLAN_LABEL[contract.plan_type] ?? contract.plan_type);
  if (contract.duration_months) {
    drawKeyValue(doc, "Duración", `${contract.duration_months} meses`);
  }
  if (contract.permanence_months) {
    drawKeyValue(doc, "Permanencia", `${contract.permanence_months} meses`);
  }
  if (contract.maintenance_included) {
    drawKeyValue(
      doc,
      "Mantenimiento",
      `Incluido${contract.maintenance_months_included ? ` (${contract.maintenance_months_included} meses)` : ""}`,
    );
  }
  if (contract.signed_at) {
    drawKeyValue(doc, "Firmado", fmtDate(contract.signed_at));
  }

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
  drawText(doc, `TOTAL: ${fmtEur(contract.total_cash_cents)}`, {
    bold: true,
    size: 14,
    color: COLORS.brand,
  });
  if (contract.monthly_cents) {
    drawText(doc, `Cuota mensual: ${fmtEur(contract.monthly_cents)}`, { size: 11 });
  }

  if (payments.length > 0) {
    drawSection(doc, "Plan de pagos");
    drawTable(
      doc,
      ["Concepto", "Importe", "Método", "Momento"],
      payments.map((p) => ({
        cells: [
          p.concept,
          fmtEur(p.amount_cents),
          METHOD_LABEL[p.method] ?? p.method,
          MOMENT_LABEL[p.moment] ?? p.moment,
        ],
      })),
      [220, 90, 100, 90],
    );
  }

  if (contract.notes) {
    drawSection(doc, "Notas");
    drawText(doc, contract.notes, { size: 10, maxWidth: 495 });
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
