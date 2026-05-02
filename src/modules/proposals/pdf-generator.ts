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
import { getProposal, getProposalItems } from "./actions";

export async function generateProposalPdf(proposalId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  const [proposal, items] = await Promise.all([
    getProposal(proposalId),
    getProposalItems(proposalId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: company } = await supabase
    .from("companies")
    .select("legal_name, trade_name, tax_id")
    .eq("id", session.company_id)
    .single();
  const c = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const companyName = c.trade_name || c.legal_name || "Empresa";

  const doc = await newDoc();
  drawHeader(
    doc,
    `Propuesta ${proposal.reference_code ?? ""}`.trim(),
    `${companyName}${c.tax_id ? ` · ${c.tax_id}` : ""}`,
  );

  drawSection(doc, "Datos");
  drawKeyValue(doc, "Cliente", proposal.customer_or_lead_name);
  drawKeyValue(doc, "Versión", `#${proposal.version_number}`);
  drawKeyValue(doc, "Fecha", fmtDate(proposal.created_at));
  if (proposal.validity_until) {
    drawKeyValue(doc, "Validez hasta", fmtDate(proposal.validity_until));
  }

  drawSection(doc, "Equipos / Servicios");
  drawTable(
    doc,
    ["Concepto", "Cant.", "Precio", "Subtotal"],
    items.map((it) => ({
      cells: [
        it.product_name_snapshot,
        String(it.quantity),
        fmtEur(it.unit_price_cash_cents),
        fmtEur((it.unit_price_cash_cents ?? 0) * it.quantity),
      ],
    })),
    [260, 60, 90, 90],
  );

  drawHr(doc);
  drawText(doc, `TOTAL CONTADO: ${fmtEur(proposal.total_cash_cents)}`, {
    bold: true,
    size: 14,
    color: COLORS.brand,
  });

  if (proposal.monthly_renting_min_cents || proposal.monthly_rental_cents) {
    drawSection(doc, "Opciones financieras");
    if (proposal.monthly_renting_min_cents) {
      drawKeyValue(
        doc,
        "Renting (mes)",
        `${fmtEur(proposal.monthly_renting_min_cents)} – ${fmtEur(
          proposal.monthly_renting_max_cents,
        )}`,
      );
    }
    if (proposal.monthly_rental_cents) {
      drawKeyValue(doc, "Alquiler (mes)", fmtEur(proposal.monthly_rental_cents));
    }
  }

  if (proposal.notes) {
    drawSection(doc, "Notas");
    drawText(doc, proposal.notes, { size: 10, maxWidth: 495 });
  }

  drawHr(doc);
  drawText(
    doc,
    "Documento informativo. Las condiciones definitivas se reflejarán en el contrato.",
    { size: 8, color: COLORS.muted },
  );

  return await doc.pdf.save();
}
