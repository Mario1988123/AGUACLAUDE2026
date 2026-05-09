"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  newDashDoc,
  drawDashHeader,
  drawSectionTitle,
  drawParagraph,
  drawDashFooter,
  fmtDateLong,
  fmtDateShort,
  fmtEur,
} from "@/shared/lib/pdf/dashstack";
import { DEFAULT_FREE_TRIAL_CONDITIONS } from "@/modules/config/free-trials/defaults";

interface FreeTrialData {
  id: string;
  reference_code: string | null;
  status: string;
  duration_days: number;
  conditions_text: string | null;
  installed_at: string | null;
  expires_at: string | null;
  created_at: string;
  installation_address_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
}

/**
 * Sustituye los placeholders del template de condiciones por valores reales.
 */
function applyPlaceholders(
  template: string,
  data: {
    cliente: string;
    empresa: string;
    equipo: string;
    direccion: string;
    dias_prueba: number;
    fecha_entrega: string;
    fecha_devolucion: string;
    precio_renting_mes: string;
    duracion_renting: string;
  },
): string {
  let out = template;
  for (const [key, value] of Object.entries(data)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * Genera el albarán de entrega (PDF) de una prueba gratuita.
 * El texto de las condiciones viene de free_trials.conditions_text si
 * existe, o de la plantilla por defecto. Los placeholders se sustituyen
 * con datos reales del cliente, dirección, equipo, fechas y empresa.
 */
export async function generateFreeTrialDeliveryNotePdf(
  trialId: string,
): Promise<Uint8Array> {
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Cargar prueba
  const { data: trialRow } = await admin
    .from("free_trials")
    .select(
      "id, reference_code, status, duration_days, conditions_text, installed_at, expires_at, created_at, installation_address_id, customer_id, lead_id",
    )
    .eq("id", trialId)
    .maybeSingle();
  if (!trialRow) throw new Error("Prueba no encontrada");
  const trial = trialRow as FreeTrialData;

  // 2) Cargar items
  const { data: itemsRows } = await admin
    .from("free_trial_items")
    .select("product_name_snapshot, quantity, serial_number")
    .eq("free_trial_id", trial.id);
  const items = ((itemsRows ?? []) as Array<{
    product_name_snapshot: string;
    quantity: number;
    serial_number: string | null;
  }>);

  // 3) Cargar cliente o lead
  let clientName = "Cliente";
  let clientTaxId: string | null = null;
  let clientEmail: string | null = null;
  let clientPhone: string | null = null;
  if (trial.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary")
      .eq("id", trial.customer_id)
      .maybeSingle();
    if (c) {
      clientName =
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "Cliente"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Cliente";
      clientTaxId = c.tax_id;
      clientEmail = c.email;
      clientPhone = c.phone_primary;
    }
  } else if (trial.lead_id) {
    const { data: l } = await admin
      .from("leads")
      .select("party_kind, legal_name, trade_name, first_name, last_name, tax_id, email, phone_primary")
      .eq("id", trial.lead_id)
      .maybeSingle();
    if (l) {
      clientName =
        l.party_kind === "company"
          ? l.trade_name || l.legal_name || "Cliente"
          : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Cliente";
      clientTaxId = l.tax_id;
      clientEmail = l.email;
      clientPhone = l.phone_primary;
    }
  }

  // 4) Cargar dirección
  let addressStr = "—";
  if (trial.installation_address_id) {
    const { data: a } = await admin
      .from("addresses")
      .select("street_type, street, street_number, portal, floor, door, postal_code, city, province")
      .eq("id", trial.installation_address_id)
      .maybeSingle();
    if (a) {
      addressStr = [
        `${a.street_type ?? ""} ${a.street ?? ""} ${a.street_number ?? ""}`.trim(),
        a.portal ? `Portal ${a.portal}` : null,
        a.floor ? `${a.floor}º` : null,
        a.door ? a.door : null,
        a.postal_code,
        a.city,
        a.province,
      ]
        .filter(Boolean)
        .join(", ");
    }
  }

  // 5) Cargar empresa
  const { data: company } = await admin
    .from("companies")
    .select("legal_name, trade_name, tax_id, email, phone")
    .eq("id", session.company_id!)
    .maybeSingle();
  const companyName = company?.trade_name || company?.legal_name || "Mi Empresa";

  // 6) Cargar configuración (para placeholders + plantilla fallback)
  const { data: settings } = await admin
    .from("company_settings")
    .select("extra")
    .eq("company_id", session.company_id!)
    .maybeSingle();
  const ftConfig =
    ((settings?.extra as Record<string, unknown> | null)?.free_trials as
      | { conditions_text?: string; default_renting_quote_months?: number }
      | undefined) ?? {};
  const rentingMonths = ftConfig.default_renting_quote_months ?? 48;

  // 7) Sustituir placeholders en el texto de condiciones
  const equipoStr = items
    .map(
      (i) =>
        `${i.product_name_snapshot} x${i.quantity}` +
        (i.serial_number ? ` (S/N ${i.serial_number})` : ""),
    )
    .join(", ") || "—";
  const fechaEntrega = trial.installed_at ?? trial.created_at;
  const fechaDevolucion =
    trial.expires_at ??
    (() => {
      const d = new Date(fechaEntrega);
      d.setDate(d.getDate() + trial.duration_days);
      return d.toISOString();
    })();

  const baseTemplate =
    trial.conditions_text ||
    ftConfig.conditions_text ||
    DEFAULT_FREE_TRIAL_CONDITIONS;

  const conditionsText = applyPlaceholders(baseTemplate, {
    cliente: clientName,
    empresa: companyName,
    equipo: equipoStr,
    direccion: addressStr,
    dias_prueba: trial.duration_days,
    fecha_entrega: fmtDateLong(fechaEntrega),
    fecha_devolucion: fmtDateLong(fechaDevolucion),
    precio_renting_mes: "—", // sin precio guardado en la prueba
    duracion_renting: `${rentingMonths} meses`,
  });

  // 8) Generar PDF
  const d = await newDashDoc();

  drawDashHeader(d, {
    companyName,
    companyPhone: company?.phone ?? null,
    companyEmail: company?.email ?? null,
    title: "ALBARÁN DE ENTREGA EN PRUEBA",
    refCode: trial.reference_code ?? `#${trial.id.slice(0, 8)}`,
    dateLabel: fmtDateLong(fechaEntrega),
    statusBadge: { label: "EN PRUEBA", tone: "warning" },
  });

  drawSectionTitle(d, "Cliente");
  drawParagraph(
    d,
    [
      clientName,
      clientTaxId ? `CIF/NIF: ${clientTaxId}` : null,
      clientEmail,
      clientPhone,
    ]
      .filter(Boolean)
      .join("  ·  "),
  );

  drawSectionTitle(d, "Lugar de instalación");
  drawParagraph(d, addressStr);

  drawSectionTitle(d, `Equipos entregados (${items.length})`);
  if (items.length === 0) {
    drawParagraph(d, "Sin items.");
  } else {
    for (const it of items) {
      drawParagraph(
        d,
        `• ${it.product_name_snapshot} — cantidad: ${it.quantity}` +
          (it.serial_number ? ` — S/N: ${it.serial_number}` : ""),
      );
    }
  }

  drawSectionTitle(d, "Plazos");
  drawParagraph(
    d,
    `Duración de la prueba: ${trial.duration_days} días.\nFecha entrega: ${fmtDateShort(fechaEntrega)}\nFecha tope devolución: ${fmtDateShort(fechaDevolucion)}`,
  );

  drawSectionTitle(d, "Condiciones de la entrega");
  drawParagraph(d, conditionsText, 9);

  drawSectionTitle(d, "Firmas");
  drawParagraph(
    d,
    `Firma del cliente:                                            Firma de ${companyName}:`,
  );
  // Espacio para firmar a mano
  drawParagraph(d, "\n\n\n");
  drawParagraph(d, `Importe orientativo si finalmente se contrata: ${fmtEur(0)} (a indicar por la empresa)`, 8);

  drawDashFooter(d, companyName);
  return await d.pdf.save();
}
