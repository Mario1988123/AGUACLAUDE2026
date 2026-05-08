"use server";

import { rgb } from "pdf-lib";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDashDoc,
  drawCoverPage,
  drawDashHeader,
  drawTwoPartyCards,
  drawTiles,
  drawCalloutBlock,
  drawSectionTitle,
  drawDashFooter,
  drawParagraph,
  fmtEur,
  fmtDateLong,
  fmtDateShort,
} from "@/shared/lib/pdf/dashstack";

const PAGE_W = 595;
const MARGIN = 48;
const PRIMARY = rgb(0.10, 0.55, 0.55); // teal
const RED = rgb(0.86, 0.30, 0.30);
const GREEN = rgb(0.20, 0.65, 0.40);
const MUTED = rgb(0.45, 0.50, 0.55);
const BG_LIGHT = rgb(0.97, 0.98, 0.99);

const SERVICE_LABEL: Record<string, string> = {
  bottled: "Botellas de supermercado",
  service: "Servicio de garrafas",
  osmosis: "Ósmosis ya instalada",
  tap: "Solo agua del grifo",
  none: "Sin servicio",
};

const PLAN_LABEL: Record<string, string> = {
  cash: "Compra (contado)",
  rental: "Alquiler",
  renting: "Renting",
};

interface SavingsRow {
  id: string;
  reference_code: string | null;
  customer_id: string | null;
  lead_id: string | null;
  client_type: string;
  num_people: number;
  liters_per_person_day: number;
  current_service: string;
  current_brand_name_snapshot: string | null;
  current_garrafas_per_month: number | null;
  current_monthly_cost_cents: number;
  product_name_snapshot: string | null;
  plan_type: string;
  duration_months: number | null;
  product_unit_price_cents: number | null;
  num_units: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extras: any[];
  total_monthly_cost_cents: number;
  deposit_cents: number;
  payback_months: number | null;
  total_saved_5y_cents: number | null;
  bottles_saved_year: number | null;
  co2_saved_year_kg: number | null;
  plastic_saved_year_kg: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export async function generateSavingsPdf(savingsId: string): Promise<Uint8Array> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: row } = await admin
    .from("savings_proposals")
    .select("*")
    .eq("id", savingsId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const sp = row as SavingsRow | null;
  if (!sp) throw new Error("Propuesta de ahorro no encontrada");

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

  // Resolver nombre del destinatario
  let recipientName = "Cliente";
  let recipientLine: string | null = null;
  let addrLine: string | null = null;
  if (sp.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id")
      .eq("id", sp.customer_id)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = c as any;
    if (cc) {
      recipientName =
        cc.party_kind === "company"
          ? cc.trade_name || cc.legal_name || "Cliente"
          : `${cc.first_name ?? ""} ${cc.last_name ?? ""}`.trim() || "Cliente";
      if (cc.tax_id) recipientLine = `${cc.party_kind === "company" ? "CIF" : "DNI"} ${cc.tax_id}`;
    }
    const { data: a } = await supabase
      .from("addresses")
      .select("street, street_number, postal_code, city")
      .eq("customer_id", sp.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (a) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aa = a as any;
      const parts = [
        aa.street ? `${aa.street}${aa.street_number ? " " + aa.street_number : ""}` : null,
        aa.postal_code,
        aa.city,
      ].filter(Boolean);
      addrLine = parts.join(", ");
    }
  } else if (sp.lead_id) {
    const { data: l } = await supabase
      .from("leads")
      .select("party_kind, legal_name, trade_name, first_name, last_name")
      .eq("id", sp.lead_id)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ll = l as any;
    if (ll) {
      recipientName =
        ll.party_kind === "company"
          ? ll.trade_name || ll.legal_name || "Lead"
          : `${ll.first_name ?? ""} ${ll.last_name ?? ""}`.trim() || "Lead";
    }
  }

  // Comercial
  let commercialName: string | null = null;
  if (sp.created_by ?? null) {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("full_name, display_name")
      .eq("user_id", sp.created_by ?? "")
      .maybeSingle();
    const p = prof as { full_name: string | null; display_name: string | null } | null;
    commercialName = p?.display_name?.trim() || p?.full_name?.trim() || null;
  }

  const d = await newDashDoc();
  const companyName = co.trade_name || co.legal_name || "Empresa";

  // ============================================================================
  // PÁGINA 1: PORTADA
  // ============================================================================
  drawCoverPage(d, {
    companyName,
    documentTitle: "PROPUESTA DE AHORRO",
    documentRef: sp.reference_code,
    recipientName,
    recipientLine,
    dateLabel: fmtDateLong(sp.created_at),
  });

  // ============================================================================
  // PÁGINA 2: DATOS + CONSUMO ACTUAL
  // ============================================================================
  drawDashHeader(d, {
    companyName,
    companyPhone: cs.contact_phone ?? null,
    companyEmail: cs.contact_email ?? null,
    title: "PROPUESTA DE AHORRO",
    refCode: sp.reference_code ?? null,
    dateLabel: fmtDateLong(sp.created_at),
    statusBadge: { label: "Comparativa", tone: "success" },
  });

  drawTwoPartyCards(
    d,
    {
      title: "Empresa",
      rows: [
        ["Razón social", co.legal_name || co.trade_name || "—"],
        ["CIF", co.tax_id ?? null],
        ["Dirección", cs.fiscal_address ?? null],
        ["Población", [cs.fiscal_postal_code, cs.fiscal_city].filter(Boolean).join(" ") || null],
        ["Tel.", cs.contact_phone ?? null],
        ["Email", cs.contact_email ?? null],
      ],
    },
    {
      title: "Para",
      rows: [
        ["Cliente", recipientName],
        ["Identificación", recipientLine],
        ["Dirección", addrLine],
      ],
    },
  );

  drawSectionTitle(d, "Consumo actual del cliente");

  const peopleLine =
    sp.client_type === "office"
      ? `${sp.num_people} personas en oficina (${sp.liters_per_person_day} L/persona/día)`
      : `${sp.num_people} personas en hogar (${sp.liters_per_person_day} L/persona/día)`;

  drawCalloutBlock(d, {
    title: "Datos del consumo",
    tone: "info",
    rows: [
      ["Servicio actual", SERVICE_LABEL[sp.current_service] ?? sp.current_service],
      ...(sp.current_brand_name_snapshot
        ? ([["Marca", sp.current_brand_name_snapshot]] as Array<[string, string]>)
        : []),
      ...(sp.current_garrafas_per_month
        ? ([["Garrafas/mes", `${sp.current_garrafas_per_month}`]] as Array<[string, string]>)
        : []),
      ["Personas", peopleLine],
    ],
  });

  drawTiles(d, [
    {
      label: "Coste mensual actual",
      value: fmtEur(sp.current_monthly_cost_cents),
      sub: "Lo que paga hoy",
    },
    {
      label: "Coste anual actual",
      value: fmtEur(sp.current_monthly_cost_cents * 12),
      sub: "Estimado a 1 año",
    },
    {
      label: "Coste a 5 años",
      value: fmtEur(sp.current_monthly_cost_cents * 60),
      sub: "Si no cambia nada",
    },
  ]);

  // ============================================================================
  // PÁGINA 3: NUESTRA PROPUESTA + COMPARATIVA
  // ============================================================================
  d.page = d.pdf.addPage([595, 842]);
  d.cursorY = 842 - MARGIN;
  drawDashHeader(d, {
    companyName,
    companyPhone: cs.contact_phone ?? null,
    companyEmail: cs.contact_email ?? null,
    title: "PROPUESTA DE AHORRO",
    refCode: sp.reference_code ?? null,
    dateLabel: fmtDateLong(sp.created_at),
    statusBadge: { label: "Comparativa", tone: "success" },
  });

  drawSectionTitle(d, "Nuestra propuesta");

  const productLine =
    sp.product_name_snapshot ?? "Producto" + (sp.num_units > 1 ? ` (×${sp.num_units})` : "");
  const planSubline =
    sp.plan_type === "renting" && sp.duration_months
      ? `${PLAN_LABEL[sp.plan_type]} · ${sp.duration_months} meses`
      : PLAN_LABEL[sp.plan_type] ?? sp.plan_type;
  const extrasList = (sp.extras ?? []) as Array<{
    name?: string;
    role?: string;
    monthly_cents?: number;
    install_cents?: number;
  }>;

  drawCalloutBlock(d, {
    title: productLine,
    tone: "success",
    rows: [
      ["Plan", planSubline],
      [
        sp.plan_type === "cash" ? "Total contado" : "Cuota mensual",
        fmtEur(sp.plan_type === "cash" ? sp.product_unit_price_cents : sp.total_monthly_cost_cents),
      ],
      ...(sp.plan_type === "rental" && sp.deposit_cents > 0
        ? ([["Fianza inicial", fmtEur(sp.deposit_cents)]] as Array<[string, string]>)
        : []),
      ...(extrasList.length > 0
        ? ([
            [
              "Extras incluidos",
              extrasList
                .map((e) => `${e.name ?? "Extra"}${e.role === "tap" ? " (grifería)" : e.role === "cooler" ? " (enfriador)" : ""}`)
                .join(", "),
            ],
          ] as Array<[string, string]>)
        : []),
    ],
  });

  // ----------- Comparativa visual: 2 barras horizontales -----------
  drawSectionTitle(d, "Comparativa visual mensual");

  const barAreaTop = d.cursorY;
  const barAreaH = 110;
  const barH = 28;
  const barLabelW = 130;
  const maxBarW = PAGE_W - MARGIN * 2 - barLabelW - 90;
  const maxValue = Math.max(
    sp.current_monthly_cost_cents,
    sp.total_monthly_cost_cents,
    sp.plan_type === "cash" ? (sp.product_unit_price_cents ?? 0) / 60 : sp.total_monthly_cost_cents,
    1,
  );
  const ourMonthly =
    sp.plan_type === "cash"
      ? Math.round((sp.product_unit_price_cents ?? 0) / 60)
      : sp.total_monthly_cost_cents;

  // Background
  d.page.drawRectangle({
    x: MARGIN,
    y: barAreaTop - barAreaH,
    width: PAGE_W - MARGIN * 2,
    height: barAreaH,
    color: BG_LIGHT,
    borderColor: BG_LIGHT,
  });

  function drawBar(
    label: string,
    value: number,
    color: ReturnType<typeof rgb>,
    yOffset: number,
  ) {
    const barW = (value / maxValue) * maxBarW;
    const y = barAreaTop - yOffset - barH;
    // Label
    d.page.drawText(label, {
      x: MARGIN + 14,
      y: y + 9,
      size: 10,
      font: d.bold,
      color: MUTED,
    });
    // Bar background
    d.page.drawRectangle({
      x: MARGIN + barLabelW,
      y,
      width: maxBarW,
      height: barH,
      color: rgb(0.92, 0.93, 0.95),
      borderColor: rgb(0.92, 0.93, 0.95),
    });
    // Filled bar
    d.page.drawRectangle({
      x: MARGIN + barLabelW,
      y,
      width: Math.max(barW, 4),
      height: barH,
      color,
      borderColor: color,
    });
    // Value text
    d.page.drawText(fmtEur(value), {
      x: MARGIN + barLabelW + barW + 8,
      y: y + 9,
      size: 11,
      font: d.bold,
      color: rgb(0.15, 0.15, 0.15),
    });
  }

  drawBar("Hoy paga", sp.current_monthly_cost_cents, RED, 24);
  drawBar("Con nosotros", ourMonthly, GREEN, 70);

  d.cursorY = barAreaTop - barAreaH - 16;

  // ----------- Tiles de ahorro -----------
  drawSectionTitle(d, "Tu ahorro");

  const paybackText =
    sp.payback_months != null
      ? sp.payback_months <= 12
        ? `${sp.payback_months} meses`
        : `${Math.ceil(sp.payback_months / 12)} año${Math.ceil(sp.payback_months / 12) === 1 ? "" : "s"}`
      : "—";

  drawTiles(d, [
    {
      label: "Año de amortización",
      value: paybackText,
      sub: sp.payback_months != null ? "A partir de aquí, ahorras" : "Sin amortización clara",
    },
    {
      label: "Ahorro acumulado a 5 años",
      value: fmtEur(sp.total_saved_5y_cents),
      sub: "Total estimado",
    },
    {
      label: "Ahorro mensual",
      value: fmtEur(Math.max(0, sp.current_monthly_cost_cents - ourMonthly)),
      sub: "A partir del año de amortización",
    },
  ]);

  // ============================================================================
  // PÁGINA 4: IMPACTO ECOLÓGICO
  // ============================================================================
  d.page = d.pdf.addPage([595, 842]);
  d.cursorY = 842 - MARGIN;
  drawDashHeader(d, {
    companyName,
    companyPhone: cs.contact_phone ?? null,
    companyEmail: cs.contact_email ?? null,
    title: "PROPUESTA DE AHORRO",
    refCode: sp.reference_code ?? null,
    dateLabel: fmtDateLong(sp.created_at),
    statusBadge: { label: "Impacto eco", tone: "success" },
  });

  drawSectionTitle(d, "Tu impacto ecológico al año");

  drawParagraph(
    d,
    "Al cambiar a nuestra solución, no solo ahorras dinero — también reduces el plástico que llega a los océanos y las emisiones de CO₂ generadas por la producción y transporte de botellas de plástico.",
  );

  drawTiles(d, [
    {
      label: "Botellas plástico evitadas",
      value: `${(sp.bottles_saved_year ?? 0).toLocaleString("es-ES")}`,
      sub: "al año (1.5 L)",
    },
    {
      label: "CO₂ evitado",
      value: `${sp.co2_saved_year_kg ?? 0} kg`,
      sub: "al año",
    },
    {
      label: "Plástico evitado",
      value: `${sp.plastic_saved_year_kg ?? 0} kg`,
      sub: "al año",
    },
  ]);

  // Bloque grande con cifras 5 años
  drawSectionTitle(d, "Y a 5 años…");

  drawCalloutBlock(d, {
    title: "Tu huella reducida en 5 años",
    tone: "success",
    rows: [
      [
        "Botellas evitadas",
        `${((sp.bottles_saved_year ?? 0) * 5).toLocaleString("es-ES")} botellas`,
      ],
      ["CO₂ evitado", `${((sp.co2_saved_year_kg ?? 0) * 5).toFixed(1)} kg`],
      ["Plástico evitado", `${((sp.plastic_saved_year_kg ?? 0) * 5).toFixed(1)} kg`],
    ],
  });

  if (sp.notes) {
    drawSectionTitle(d, "Notas");
    drawParagraph(d, sp.notes);
  }

  // ============================================================================
  // FOOTER (todas las páginas)
  // ============================================================================
  const footerLines = [
    companyName,
    [cs.contact_phone, cs.contact_email].filter(Boolean).join(" · "),
    commercialName ? `Comercial: ${commercialName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Aplicamos footer al final
  for (let i = 0; i < d.pdf.getPageCount(); i++) {
    const p = d.pdf.getPage(i);
    p.drawText(footerLines, {
      x: MARGIN,
      y: 30,
      size: 8,
      font: d.font,
      color: MUTED,
    });
    p.drawText(`${i + 1}/${d.pdf.getPageCount()}`, {
      x: PAGE_W - MARGIN - 20,
      y: 30,
      size: 8,
      font: d.font,
      color: MUTED,
    });
  }

  // Suprimir unused imports warning
  void drawDashFooter;
  void fmtDateShort;
  void PRIMARY;

  return await d.pdf.save();
}
