"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import type { ReminderLevel } from "./payment-reminder-templates";

/**
 * Registra que se envió un recordatorio de impago al cliente. NO envía el
 * email por sí mismo — el frontend abre mailto: o llama a Resend.
 */
export async function logPaymentReminderAction(input: {
  invoice_id: string;
  level: ReminderLevel;
  channel: "email" | "whatsapp" | "manual";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Anti cross-tenant: verificar que la factura (parent) es de MI empresa
    // antes de registrar el evento colgante con su id desde el navegador.
    const { data: ownInvoice } = await admin
      .from("invoices")
      .select("id")
      .eq("id", input.invoice_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!ownInvoice) return { ok: false, error: "Factura no encontrada" };
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "invoice",
      subject_id: input.invoice_id,
      kind: "invoice.payment_reminder_sent",
      payload: { level: input.level, channel: input.channel },
      actor_user_id: session.user_id,
    });
    revalidatePath(`/facturas/${input.invoice_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Sugiere el nivel del recordatorio según los días de vencimiento y los
 * recordatorios previos enviados (registrados como events
 * `invoice.payment_reminder_sent`).
 */
export async function suggestReminderLevel(input: {
  invoice_id: string;
  days_overdue: number;
}): Promise<ReminderLevel> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    // Anti cross-tenant: scopear la lectura de events a MI empresa. Sin esto un
    // usuario podría leer recordatorios de una factura de otra empresa por su id.
    const session = await requireSession();
    if (!session.company_id) return "first";
    const { data: events } = await admin
      .from("events")
      .select("payload")
      .eq("company_id", session.company_id)
      .eq("subject_type", "invoice")
      .eq("subject_id", input.invoice_id)
      .eq("kind", "invoice.payment_reminder_sent");
    const sent = ((events ?? []) as Array<{ payload: { level?: ReminderLevel } }>).map(
      (e) => e.payload?.level,
    );
    if (!sent.includes("first")) return "first";
    if (!sent.includes("second") && input.days_overdue >= 30) return "second";
    if (input.days_overdue >= 60) return "final";
    return "second";
  } catch {
    return "first";
  }
}
