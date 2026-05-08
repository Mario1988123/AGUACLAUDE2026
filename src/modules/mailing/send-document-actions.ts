"use server";

/**
 * Server actions para enviar documentos del CRM por email al cliente:
 * propuesta, contrato, factura. Cada uno carga su PDF, lo adjunta y
 * usa la plantilla transaccional correspondiente.
 */

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { sendTransactionalEmail } from "./actions";

async function fetchPdfAsBase64(internalUrl: string): Promise<string | null> {
  // Llamada interna al endpoint /api/pdf/... — Vercel runtime lo permite.
  // Necesitamos URL absoluta con host.
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.VERCEL_URL ?? // ej. "aguaclaude2026.vercel.app"
      "http://localhost:3000";
    const url = baseUrl.startsWith("http")
      ? `${baseUrl}${internalUrl}`
      : `https://${baseUrl}${internalUrl}`;
    const res = await fetch(url, {
      headers: { Accept: "application/pdf" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[send-doc] fetch PDF ${url} → ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (e) {
    console.error("[send-doc] fetch PDF failed:", e);
    return null;
  }
}

// =====================================================================
// PROPUESTA
// =====================================================================

export async function sendProposalByEmailAction(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: prop } = await admin
    .from("proposals")
    .select(
      `id, reference_code, total_cash_cents, validity_until, customer_id, lead_id, company_id`,
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (!prop) return { ok: false, error: "Propuesta no encontrada" };
  if (prop.company_id !== session.company_id) {
    return { ok: false, error: "Propuesta de otra empresa" };
  }

  // Resolver email + nombre del destinatario (customer o lead)
  let toEmail: string | null = null;
  let toName: string | null = null;
  if (prop.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("email, first_name, last_name, legal_name, trade_name, party_kind")
      .eq("id", prop.customer_id)
      .maybeSingle();
    toEmail = c?.email ?? null;
    toName = nameOf(c);
  } else if (prop.lead_id) {
    const { data: l } = await admin
      .from("leads")
      .select("email, first_name, last_name, legal_name, trade_name, party_kind")
      .eq("id", prop.lead_id)
      .maybeSingle();
    toEmail = l?.email ?? null;
    toName = nameOf(l);
  }

  if (!toEmail) {
    return {
      ok: false,
      error: "El cliente/lead no tiene email registrado",
    };
  }

  // PDF de la propuesta
  const pdfBase64 = await fetchPdfAsBase64(`/api/pdf/proposal/${proposalId}`);

  return sendTransactionalEmail({
    template_key: "proposal_sent",
    to_email: toEmail,
    to_name: toName ?? "Cliente",
    customer_id: prop.customer_id,
    lead_id: prop.lead_id,
    variables: {
      proposal_reference: prop.reference_code ?? "—",
      proposal_total: prop.total_cash_cents ?? 0,
      proposal_validity: prop.validity_until ?? "",
    },
    attachments: pdfBase64
      ? [
          {
            filename: `propuesta-${prop.reference_code ?? proposalId.slice(0, 8)}.pdf`,
            content_base64: pdfBase64,
          },
        ]
      : undefined,
    related_subject_type: "proposal",
    related_subject_id: proposalId,
  });
}

// =====================================================================
// CONTRATO
// =====================================================================

export async function sendContractByEmailAction(
  contractId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: c } = await admin
    .from("contracts")
    .select(`id, reference_code, customer_id, company_id`)
    .eq("id", contractId)
    .maybeSingle();
  if (!c) return { ok: false, error: "Contrato no encontrado" };
  if (c.company_id !== session.company_id) {
    return { ok: false, error: "Contrato de otra empresa" };
  }

  const { data: cust } = await admin
    .from("customers")
    .select("email, first_name, last_name, legal_name, trade_name, party_kind")
    .eq("id", c.customer_id)
    .maybeSingle();
  if (!cust?.email) {
    return { ok: false, error: "El cliente no tiene email registrado" };
  }

  // Resumen de equipos del contrato
  const { data: items } = await admin
    .from("contract_items")
    .select("quantity, products(name)")
    .eq("contract_id", contractId);
  const equipmentSummary =
    (items ?? [])
      .map(
        (it: { quantity: number; products: { name: string } | null }) =>
          `${it.quantity}× ${it.products?.name ?? "Equipo"}`,
      )
      .join(", ") || "tu equipo";

  const pdfBase64 = await fetchPdfAsBase64(`/api/pdf/contract/${contractId}`);

  return sendTransactionalEmail({
    template_key: "contract_signed",
    to_email: cust.email,
    to_name: nameOf(cust) ?? "Cliente",
    customer_id: c.customer_id,
    variables: {
      contract_reference: c.reference_code ?? "—",
      equipment_summary: equipmentSummary,
    },
    attachments: pdfBase64
      ? [
          {
            filename: `contrato-${c.reference_code ?? contractId.slice(0, 8)}.pdf`,
            content_base64: pdfBase64,
          },
        ]
      : undefined,
    related_subject_type: "contract",
    related_subject_id: contractId,
  });
}

// =====================================================================
// FACTURA
// =====================================================================

export async function sendInvoiceByEmailAction(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: inv } = await admin
    .from("invoices")
    .select(
      `id, reference_code, customer_id, customer_snapshot, total_cents,
       issued_at, due_at, company_id`,
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Factura no encontrada" };
  if (inv.company_id !== session.company_id) {
    return { ok: false, error: "Factura de otra empresa" };
  }

  // Email del snapshot o del customer actual
  const snap = inv.customer_snapshot as { email?: string; first_name?: string };
  let toEmail: string | null = snap?.email ?? null;
  let toName: string | null = snap?.first_name ?? null;
  if (!toEmail && inv.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("email, first_name, last_name, legal_name, trade_name, party_kind")
      .eq("id", inv.customer_id)
      .maybeSingle();
    toEmail = c?.email ?? null;
    toName = nameOf(c);
  }
  if (!toEmail) {
    return { ok: false, error: "Sin email del cliente en la factura" };
  }

  const pdfBase64 = await fetchPdfAsBase64(
    `/api/pdf/invoice-verifactu/${invoiceId}`,
  );

  return sendTransactionalEmail({
    template_key: "invoice_sent",
    to_email: toEmail,
    to_name: toName ?? "Cliente",
    customer_id: inv.customer_id,
    variables: {
      invoice_reference: inv.reference_code ?? "—",
      invoice_date: inv.issued_at ?? new Date().toISOString(),
      invoice_total: inv.total_cents ?? 0,
      invoice_due: inv.due_at ?? "",
    },
    attachments: pdfBase64
      ? [
          {
            filename: `factura-${inv.reference_code ?? invoiceId.slice(0, 8)}.pdf`,
            content_base64: pdfBase64,
          },
        ]
      : undefined,
    related_subject_type: "invoice",
    related_subject_id: invoiceId,
  });
}

// =====================================================================
// PROPUESTA DE AHORRO
// =====================================================================

export async function sendSavingsByEmailAction(
  savingsId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (!session.company_id) return { ok: false, error: "Sin empresa" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: sp } = await admin
    .from("savings_proposals")
    .select(
      "id, reference_code, customer_id, lead_id, company_id, current_monthly_cost_cents, total_monthly_cost_cents, total_saved_5y_cents, payback_months",
    )
    .eq("id", savingsId)
    .maybeSingle();
  if (!sp) return { ok: false, error: "Propuesta de ahorro no encontrada" };
  if (sp.company_id !== session.company_id) {
    return { ok: false, error: "Propuesta de otra empresa" };
  }

  let toEmail: string | null = null;
  let toName: string | null = null;
  if (sp.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("email, first_name, last_name, legal_name, trade_name, party_kind")
      .eq("id", sp.customer_id)
      .maybeSingle();
    toEmail = c?.email ?? null;
    toName = nameOf(c);
  } else if (sp.lead_id) {
    const { data: l } = await admin
      .from("leads")
      .select("email, first_name, last_name, legal_name, trade_name, party_kind")
      .eq("id", sp.lead_id)
      .maybeSingle();
    toEmail = l?.email ?? null;
    toName = nameOf(l);
  }

  if (!toEmail) {
    return { ok: false, error: "El cliente/lead no tiene email registrado" };
  }

  const pdfBase64 = await fetchPdfAsBase64(`/api/pdf/savings/${savingsId}`);

  const r = await sendTransactionalEmail({
    template_key: "savings_proposal_sent",
    to_email: toEmail,
    to_name: toName ?? "Cliente",
    customer_id: sp.customer_id,
    lead_id: sp.lead_id,
    variables: {
      savings_reference: sp.reference_code ?? "—",
      current_monthly: sp.current_monthly_cost_cents,
      our_monthly: sp.total_monthly_cost_cents,
      saved_5y: sp.total_saved_5y_cents ?? 0,
      payback_months: sp.payback_months ?? "—",
    },
    attachments: pdfBase64
      ? [
          {
            filename: `propuesta-ahorro-${sp.reference_code ?? savingsId.slice(0, 8)}.pdf`,
            content_base64: pdfBase64,
          },
        ]
      : undefined,
    related_subject_type: "savings_proposal",
    related_subject_id: savingsId,
  });

  if (r.ok) {
    await admin
      .from("savings_proposals")
      .update({ sent_by_email_at: new Date().toISOString(), status: "sent" })
      .eq("id", savingsId);
  }
  return r;
}

// =====================================================================
// Helper compartido
// =====================================================================

function nameOf(c: {
  party_kind?: "individual" | "company" | null;
  first_name?: string | null;
  last_name?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
} | null): string | null {
  if (!c) return null;
  if (c.party_kind === "company") {
    return c.trade_name || c.legal_name || null;
  }
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || null;
}
