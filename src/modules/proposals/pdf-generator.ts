"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDashDoc,
  drawCoverPage,
  drawDashHeader,
  drawTwoPartyCards,
  drawTiles,
  drawCalloutBlock,
  drawSectionTitle,
  drawItemsTable,
  drawDashFooter,
  drawParagraph,
  fmtEur,
  fmtDateLong,
  fmtDateShort,
  watermarkFromProposalStatus,
} from "@/shared/lib/pdf/dashstack";
import { getProposal, getProposalItems } from "./actions";

function partyName(p: {
  party_kind?: "individual" | "company" | null;
  legal_name?: string | null;
  trade_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (p.party_kind === "company") return p.trade_name || p.legal_name || "—";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
}

export async function generateProposalPdf(proposalId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  const [proposal, items] = await Promise.all([
    getProposal(proposalId),
    getProposalItems(proposalId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const [{ data: company }, { data: companySettings }] = await Promise.all([
    supabase
      .from("companies")
      .select("legal_name, trade_name, tax_id")
      .eq("id", session.company_id)
      .single(),
    supabase
      .from("company_settings")
      .select("contact_email, contact_phone, fiscal_address, fiscal_postal_code, fiscal_city")
      .eq("company_id", session.company_id)
      .maybeSingle(),
  ]);
  const co = (company ?? {}) as {
    legal_name?: string | null;
    trade_name?: string | null;
    tax_id?: string | null;
  };
  const cs = (companySettings ?? {}) as {
    contact_email?: string | null;
    contact_phone?: string | null;
    fiscal_address?: string | null;
    fiscal_postal_code?: string | null;
    fiscal_city?: string | null;
  };

  // Resolver datos completos del destinatario (cliente o lead)
  let recipientRow: {
    party_kind?: "individual" | "company";
    legal_name?: string | null;
    trade_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tax_id?: string | null;
    phone_primary?: string | null;
  } | null = null;
  let addrLine = "—";
  if (proposal.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id, phone_primary")
      .eq("id", proposal.customer_id)
      .single();
    recipientRow = c;
    const { data: a } = await supabase
      .from("addresses")
      .select("street_type, street, street_number, postal_code, city, province")
      .eq("customer_id", proposal.customer_id)
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (a) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aa = a as any;
      addrLine = [
        `${aa.street_type ?? ""} ${aa.street ?? ""}${aa.street_number ? " " + aa.street_number : ""}`.trim(),
        `${aa.postal_code ?? ""} ${aa.city ?? ""}`.trim(),
        aa.province,
      ]
        .filter(Boolean)
        .join(", ");
    }
  } else if (proposal.lead_id) {
    const { data: l } = await supabase
      .from("leads")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id, phone_primary")
      .eq("id", proposal.lead_id)
      .single();
    recipientRow = l;
  }

  const doc = await newDashDoc();
  const today = new Date();

  // Portada (pinta sobre página 1, luego añade nueva página para el contenido)
  drawCoverPage(doc, {
    companyName: co.trade_name || co.legal_name || "Empresa",
    documentTitle: "Propuesta comercial",
    documentRef: proposal.reference_code ?? null,
    recipientName: recipientRow ? partyName(recipientRow) : proposal.customer_or_lead_name,
    recipientLine: recipientRow?.tax_id ? `DNI/CIF ${recipientRow.tax_id}` : null,
    validUntil: proposal.validity_until ? fmtDateShort(proposal.validity_until) : null,
    dateLabel: fmtDateLong(proposal.created_at ?? today),
  });

  drawDashHeader(doc, {
    companyName: co.trade_name || co.legal_name || "Empresa",
    companyPhone: cs.contact_phone ?? null,
    companyEmail: cs.contact_email ?? null,
    title: "PROPUESTA",
    refCode: proposal.reference_code ?? null,
    dateLabel: fmtDateLong(proposal.created_at ?? today),
    statusBadge: watermarkFromProposalStatus(proposal.status),
  });

  drawTwoPartyCards(
    doc,
    {
      title: "LA EMPRESA",
      rows: [
        ["Nombre", co.trade_name || co.legal_name || "—"],
        ["CIF", co.tax_id || "—"],
        [
          "Dirección",
          [cs.fiscal_address, cs.fiscal_postal_code, cs.fiscal_city].filter(Boolean).join(", ") || "—",
        ],
        ["Teléfono", cs.contact_phone || "—"],
      ],
    },
    {
      title: proposal.customer_id ? "EL CLIENTE" : "EL DESTINATARIO",
      rows: [
        ["Nombre", recipientRow ? partyName(recipientRow) : proposal.customer_or_lead_name],
        ["DNI/CIF", recipientRow?.tax_id || "—"],
        ["Dirección", addrLine],
        ["Teléfono", recipientRow?.phone_primary || "—"],
      ],
    },
  );

  // Tiles destacando totales
  const tiles = [
    { label: "VERSIÓN", value: `v${proposal.version_number}` },
    {
      label: "TOTAL CONTADO",
      value: fmtEur(proposal.total_cash_cents),
      sub: "IVA incluido",
    },
  ];
  if (proposal.monthly_renting_min_cents) {
    tiles.push({
      label: "RENTING (mes)",
      value: fmtEur(proposal.monthly_renting_min_cents),
      sub: proposal.monthly_renting_max_cents
        ? `hasta ${fmtEur(proposal.monthly_renting_max_cents)}`
        : undefined,
    });
  }
  if (proposal.monthly_rental_cents) {
    tiles.push({
      label: "ALQUILER (mes)",
      value: fmtEur(proposal.monthly_rental_cents),
      sub: undefined,
    });
  }
  drawTiles(doc, tiles);

  if (proposal.validity_until) {
    drawCalloutBlock(doc, {
      title: "VALIDEZ DE LA PROPUESTA",
      tone: "info",
      body: `Esta propuesta es válida hasta el ${fmtDateShort(proposal.validity_until)}.`,
    });
  }

  drawSectionTitle(doc, "PRODUCTOS / SERVICIOS PROPUESTOS");
  drawItemsTable(
    doc,
    items.map((it) => ({
      product: it.product_name_snapshot,
      qty: it.quantity,
      price: fmtEur(it.unit_price_cash_cents),
      subtotal: fmtEur((it.unit_price_cash_cents ?? 0) * it.quantity),
    })),
  );

  if (proposal.notes) {
    drawSectionTitle(doc, "NOTAS");
    drawParagraph(doc, proposal.notes);
  }

  const ref = proposal.reference_code ?? `#${proposal.id.slice(0, 8)}`;
  const footer = [
    co.trade_name || co.legal_name || "Empresa",
    `Propuesta ${ref}`,
    `Generada el ${fmtDateShort(today)}`,
    proposal.sent_at ? `Enviada el ${fmtDateShort(proposal.sent_at)}` : "Borrador",
  ].join("  ·  ");
  drawDashFooter(doc, footer);

  return await doc.pdf.save();
}
