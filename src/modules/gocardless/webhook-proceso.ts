import "server-only";

import { transicionPagoGcPermitida } from "./estados";

/**
 * Procesado de un evento de webhook de GoCardless (sin sesión, NO es
 * "use server"). Lo usan la ruta /api/gocardless/webhook y el reintento de
 * eventos fallidos del cron (retry.ts), que antes no reprocesaba nada.
 *
 * Cambios (I24 y C3):
 *  · Máquina de estados: un evento que llega tarde no hace retroceder un
 *    pago (`confirmed` después de `paid_out` se ignora).
 *  · Al confirmarse el cobro se aplica a su factura (invoice_payment +
 *    "paid"); una retrocesión (charged_back) lo deshace.
 *  · Todos los errores de escritura se lanzan, para que el evento quede con
 *    `error` y GoCardless lo reintente.
 */

export interface GcEvent {
  id: string;
  resource_type: string;
  action: string;
  links?: { mandate?: string; payment?: string };
  created_at?: string;
}

function mapMandateAction(action: string): string | null {
  switch (action) {
    case "submitted":
    case "active":
    case "cancelled":
    case "failed":
    case "expired":
      return action;
    default:
      return null;
  }
}

function mapPaymentAction(action: string): string | null {
  switch (action) {
    case "submitted":
    case "confirmed":
    case "paid_out":
    case "failed":
    case "cancelled":
    case "charged_back":
      return action;
    case "resubmission_requested":
      return "submitted";
    default:
      return null;
  }
}

/** Estado del wallet que corresponde a cada estado del pago. */
function walletParaPago(estado: string): string | null {
  switch (estado) {
    case "confirmed":
      return "collected";
    case "paid_out":
      return "validated";
    case "failed":
    case "charged_back":
    case "cancelled":
      // "cancelled" no existía en el enum del wallet: un pago cancelado en
      // GoCardless es, para la caja, un cobro que no llegó.
      return "rejected";
    default:
      return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function procesarEventoGc(admin: any, companyId: string, ev: GcEvent): Promise<void> {
  if (ev.resource_type === "mandates" && ev.links?.mandate) {
    await procesarMandato(admin, companyId, ev);
    return;
  }
  if (ev.resource_type === "payments" && ev.links?.payment) {
    await procesarPago(admin, companyId, ev);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function procesarMandato(admin: any, companyId: string, ev: GcEvent): Promise<void> {
  const mandateStatus = mapMandateAction(ev.action);
  if (!mandateStatus) return;
  const { data: prevMandate, error: selErr } = await admin
    .from("gocardless_mandates")
    .select("id, customer_id, status")
    .eq("gocardless_mandate_id", ev.links!.mandate)
    .eq("company_id", companyId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const pm = prevMandate as { id: string; customer_id: string | null; status: string } | null;

  const { error: updErr } = await admin
    .from("gocardless_mandates")
    .update({
      status: mandateStatus,
      ...(mandateStatus === "cancelled" ? { cancelled_at: new Date().toISOString() } : {}),
    })
    .eq("gocardless_mandate_id", ev.links!.mandate)
    .eq("company_id", companyId);
  if (updErr) throw new Error(updErr.message);

  // Aviso al admin si el mandato pasó a un estado terminal.
  if (pm && pm.status !== mandateStatus && ["cancelled", "failed", "expired"].includes(mandateStatus)) {
    try {
      let customerName = "cliente";
      if (pm.customer_id) {
        const { data: c } = await admin
          .from("customers")
          .select("party_kind, legal_name, trade_name, first_name, last_name")
          .eq("id", pm.customer_id)
          .eq("company_id", companyId)
          .maybeSingle();
        const cu = c as
          | {
              party_kind: "individual" | "company";
              legal_name: string | null;
              trade_name: string | null;
              first_name: string | null;
              last_name: string | null;
            }
          | null;
        if (cu) {
          customerName =
            cu.party_kind === "company"
              ? cu.trade_name || cu.legal_name || "cliente"
              : `${cu.first_name ?? ""} ${cu.last_name ?? ""}`.trim() || "cliente";
        }
      }
      const { notifyByRoles } = await import("@/modules/notifications/notifier");
      await notifyByRoles(companyId, ["company_admin"], {
        kind: "gocardless.mandate_lost",
        severity: "error",
        title: `Mandato SEPA ${mandateStatus}`,
        body: `El mandato de domiciliación de ${customerName} ha pasado a ${mandateStatus}. Contacta para reactivar.`,
        subject_type: "customer",
        subject_id: pm.customer_id ?? undefined,
        action_url: pm.customer_id ? `/clientes/${pm.customer_id}` : "/clientes",
      });
    } catch (e) {
      console.error("[gocardless webhook] notify mandate lost:", e);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function procesarPago(admin: any, companyId: string, ev: GcEvent): Promise<void> {
  const nuevo = mapPaymentAction(ev.action);
  if (!nuevo) return;
  const { data: pay, error: selErr } = await admin
    .from("gocardless_payments")
    .select("id, status, wallet_entry_id, contract_payment_id, invoice_id, amount_cents")
    .eq("gocardless_payment_id", ev.links!.payment)
    .eq("company_id", companyId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const p = pay as
    | {
        id: string;
        status: string;
        wallet_entry_id: string | null;
        contract_payment_id: string | null;
        invoice_id: string | null;
        amount_cents: number;
      }
    | null;
  if (!p) return; // pago que no creamos nosotros

  if (!transicionPagoGcPermitida(p.status, nuevo)) {
    // Evento repetido o desordenado: no se retrocede.
    return;
  }

  const ahora = new Date().toISOString();
  // Update condicional al estado leído: si otro evento lo movió entre medias,
  // este no pisa el resultado.
  const { data: upd, error: updErr } = await admin
    .from("gocardless_payments")
    .update({ status: nuevo, ...(nuevo === "paid_out" ? { paid_out_at: ahora } : {}) })
    .eq("id", p.id)
    .eq("status", p.status)
    .select("id");
  if (updErr) throw new Error(updErr.message);
  if (((upd ?? []) as unknown[]).length === 0) {
    throw new Error("El pago cambió de estado durante el procesado; se reintentará");
  }

  const walletStatus = walletParaPago(nuevo);
  if (walletStatus && p.wallet_entry_id) {
    const updates: Record<string, unknown> = { status: walletStatus };
    if (walletStatus === "collected") updates.collected_at = ahora;
    if (walletStatus === "validated") updates.validated_at = ahora;
    if (walletStatus === "rejected") updates.rejected_reason = `GoCardless: ${nuevo}`;
    const { error: wErr } = await admin
      .from("wallet_entries")
      .update(updates)
      .eq("id", p.wallet_entry_id)
      .eq("company_id", companyId);
    if (wErr) throw new Error(wErr.message);
  }

  if (p.contract_payment_id) {
    let cpUpd: Record<string, unknown> | null = null;
    if (nuevo === "confirmed") cpUpd = { status: "collected_pending_validation", collected_at: ahora };
    if (nuevo === "paid_out") cpUpd = { status: "validated", validated_at: ahora };
    if (nuevo === "failed" || nuevo === "charged_back" || nuevo === "cancelled") {
      // Vuelve a deberse: pendiente, para el siguiente intento o la remesa.
      cpUpd = { status: "pending" };
    }
    if (cpUpd) {
      const { error: cpErr } = await admin
        .from("contract_payments")
        .update(cpUpd)
        .eq("id", p.contract_payment_id)
        .eq("company_id", companyId)
        .neq("status", "cancelled");
      if (cpErr) throw new Error(cpErr.message);
    }
  }

  // C3: aplicar a la factura. Se toma la del pago o, si no, la del wallet.
  let invoiceId = p.invoice_id;
  if (!invoiceId && p.wallet_entry_id) {
    const { data: w } = await admin
      .from("wallet_entries")
      .select("invoice_id")
      .eq("id", p.wallet_entry_id)
      .eq("company_id", companyId)
      .maybeSingle();
    invoiceId = (w as { invoice_id: string | null } | null)?.invoice_id ?? null;
  }
  if (invoiceId && p.wallet_entry_id && (nuevo === "confirmed" || nuevo === "paid_out")) {
    const { registrarCobroFactura } = await import("@/modules/invoices/cobros");
    // Idempotente por wallet: si `confirmed` ya lo aplicó, `paid_out` no repite.
    await registrarCobroFactura({
      admin,
      companyId,
      invoiceId,
      importeCents: p.amount_cents,
      walletEntryId: p.wallet_entry_id,
      permitirBorrador: true,
      notas: "Cobro GoCardless",
    });
  }
  // Retrocesión, o fallo después de haberse confirmado: el dinero no está.
  if (p.wallet_entry_id && (nuevo === "charged_back" || nuevo === "failed")) {
    const { anularCobroDeWallet } = await import("@/modules/invoices/cobros");
    await anularCobroDeWallet({ admin, companyId, walletEntryId: p.wallet_entry_id });
  }
}
