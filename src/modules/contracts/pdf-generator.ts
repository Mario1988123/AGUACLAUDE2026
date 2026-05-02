"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDashDoc,
  drawDashHeader,
  drawTwoPartyCards,
  drawTiles,
  drawCalloutBlock,
  drawSectionTitle,
  drawClauseList,
  drawItemsTable,
  drawSignatureBlock,
  drawDashFooter,
  fmtEur,
  fmtDateLong,
  fmtDateShort,
  watermarkFromContractStatus,
} from "@/shared/lib/pdf/dashstack";
import { getContract, getContractItems, getContractPayments } from "./actions";

const PLAN_LABEL = { cash: "VENTA", renting: "RENTING", rental: "ALQUILER" } as const;
const PLAN_TITLE = {
  cash: "CONTRATO DE COMPRA",
  renting: "ANEXO DE RENTING",
  rental: "CONTRATO DE ALQUILER",
} as const;

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

function addressOneLine(a: {
  street_type?: string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  province?: string | null;
} | null): string {
  if (!a) return "—";
  const parts: string[] = [];
  if (a.street_type || a.street) {
    parts.push(`${a.street_type ? a.street_type + " " : ""}${a.street ?? ""}${a.street_number ? " " + a.street_number : ""}`.trim());
  }
  if (a.postal_code || a.city) {
    parts.push(`${a.postal_code ?? ""} ${a.city ?? ""}`.trim());
  }
  if (a.province) parts.push(a.province);
  return parts.filter(Boolean).join(", ");
}

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

  const [{ data: company }, { data: companySettings }, { data: customer }] = await Promise.all([
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
    supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary")
      .eq("id", contract.customer_id)
      .single(),
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

  // Direcciones del cliente: principal o instalación
  const { data: addresses } = await supabase
    .from("addresses")
    .select("kind, is_primary, street_type, street, street_number, postal_code, city, province")
    .eq("customer_id", contract.customer_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addrList = (addresses ?? []) as Array<any>;
  const addr = addrList[0] ?? null;
  const installAddr = addrList.find((a) => a.kind === "installation") ?? addr;
  const customerAddrLine = addressOneLine(addr);
  const installAddrLine = addressOneLine(installAddr);

  // IBAN principal
  const { data: bank } = await supabase
    .from("customer_bank_accounts")
    .select("iban, account_holder_name")
    .eq("customer_id", contract.customer_id)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ibanData = bank as { iban: string | null; account_holder_name: string | null } | null;

  // Cláusulas: snapshot del contrato si está congelado, si no, templates activos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrAny = contract as any;
  const snapshotClauses = (ctrAny.clauses_snapshot ?? []) as Array<{
    title: string;
    body: string;
  }>;
  let clauses: Array<{ title: string; body: string }> = snapshotClauses;
  if (clauses.length === 0) {
    const { data: tpls } = await supabase
      .from("contract_clause_templates")
      .select("title, body, display_order")
      .eq("company_id", session.company_id)
      .eq("plan_type", contract.plan_type)
      .eq("is_active", true)
      .order("display_order");
    clauses = ((tpls ?? []) as Array<{ title: string; body: string }>).map((t) => ({
      title: t.title,
      body: t.body,
    }));
  }

  const doc = await newDashDoc();
  const today = new Date();
  const watermark = watermarkFromContractStatus(
    contract.status,
    (ctrAny.pending_fields ?? []) as string[],
  );

  drawDashHeader(doc, {
    companyName: co.trade_name || co.legal_name || "Empresa",
    companyPhone: cs.contact_phone ?? null,
    companyEmail: cs.contact_email ?? null,
    title: PLAN_TITLE[contract.plan_type],
    refCode: contract.reference_code ?? null,
    dateLabel: fmtDateLong(contract.signed_at ?? contract.created_at ?? today),
    statusBadge: watermark,
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
      title: "EL CLIENTE",
      rows: [
        ["Nombre", partyName(cu)],
        ["DNI/CIF", cu.tax_id || "—"],
        ["Dirección", customerAddrLine],
        ["Teléfono", cu.phone_primary || "—"],
      ],
    },
  );

  // Tiles
  const tiles = [
    { label: "TIPO", value: PLAN_LABEL[contract.plan_type] },
    contract.monthly_cents
      ? { label: "CUOTA MENSUAL", value: fmtEur(contract.monthly_cents), sub: "IVA incluido" }
      : { label: "PRECIO", value: fmtEur(contract.total_cash_cents), sub: "IVA incluido" },
    { label: "TOTAL CONTRATO", value: fmtEur(contract.total_cash_cents) },
  ];
  if (contract.duration_months) {
    tiles.push({ label: "DURACIÓN", value: String(contract.duration_months), sub: "meses" });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depositCents = (contract as any).deposit_cents as number | null | undefined;
  if (depositCents != null) {
    tiles.push({ label: "FIANZA", value: fmtEur(depositCents) });
  }
  drawTiles(doc, tiles);

  // Dirección instalación
  drawCalloutBlock(doc, {
    title: "DIRECCIÓN DE INSTALACIÓN",
    tone: "info",
    body: installAddrLine,
  });

  // Datos bancarios
  if (ibanData) {
    drawCalloutBlock(doc, {
      title: "DATOS BANCARIOS",
      tone: "success",
      rows: [
        ["IBAN", ibanData.iban || "ES00"],
        ["Titular", ibanData.account_holder_name || partyName(cu)],
      ],
    });
  }

  // Términos / cláusulas
  drawSectionTitle(doc, "TÉRMINOS Y CONDICIONES");
  if (clauses.length > 0) {
    drawClauseList(doc, clauses);
  }

  // Productos
  drawSectionTitle(doc, "PRODUCTOS / SERVICIOS CONTRATADOS");
  drawItemsTable(
    doc,
    items.map((it) => ({
      product: it.product_name_snapshot,
      qty: it.quantity,
      price: fmtEur(it.unit_price_cents),
      subtotal: fmtEur(it.unit_price_cents * it.quantity),
    })),
  );

  // Plan de pagos (si los hay)
  if (payments.length > 0) {
    drawSectionTitle(doc, "PLAN DE PAGOS");
    drawItemsTable(
      doc,
      payments.map((p) => ({
        product: p.concept,
        qty: 1,
        price: fmtEur(p.amount_cents),
        subtotal: fmtEur(p.amount_cents),
      })),
    );
  }

  // Firmas
  drawSectionTitle(doc, "FIRMAS");
  drawSignatureBlock(doc, {
    company: { name: co.trade_name || co.legal_name || "Empresa" },
    customer: {
      name: partyName(cu),
      taxId: cu.tax_id ?? null,
      signedDate: contract.signed_at ? fmtDateShort(contract.signed_at) : null,
    },
  });

  const ref = contract.reference_code ?? `#${contract.id.slice(0, 8)}`;
  const footer = [
    co.trade_name || co.legal_name || "Empresa",
    `Contrato ${ref}`,
    `Generado el ${fmtDateShort(today)}`,
    contract.signed_at ? `Firmado el ${fmtDateShort(contract.signed_at)}` : "Pendiente de firma",
  ].join("  ·  ");
  drawDashFooter(doc, footer);

  return await doc.pdf.save();
}
