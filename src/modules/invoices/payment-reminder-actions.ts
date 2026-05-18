"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export type ReminderLevel = "first" | "second" | "final";

const TEMPLATES: Record<
  ReminderLevel,
  (ctx: { invoice_ref: string; customer_name: string; total_eur: string; due_days: number }) => {
    subject: string;
    body: string;
  }
> = {
  first: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `Recordatorio · Factura ${invoice_ref} pendiente`,
    body:
      `Hola ${customer_name},\n\n` +
      `Le recordamos que la factura ${invoice_ref} por importe de ${total_eur} ` +
      `vence en ${due_days} días.\n\n` +
      `Si ya ha realizado el pago, ignore este mensaje.\n\n` +
      `Quedamos a su disposición para cualquier duda.\n\n` +
      `Un saludo.`,
  }),
  second: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `2º aviso · Factura ${invoice_ref} vencida`,
    body:
      `Estimado/a ${customer_name},\n\n` +
      `La factura ${invoice_ref} por importe de ${total_eur} se encuentra ` +
      `vencida desde hace ${Math.abs(due_days)} días.\n\n` +
      `Le rogamos proceda al pago a la mayor brevedad posible. Si existe ` +
      `algún inconveniente, póngase en contacto con nosotros para acordar ` +
      `una solución.\n\n` +
      `Un saludo.`,
  }),
  final: ({ invoice_ref, customer_name, total_eur, due_days }) => ({
    subject: `REQUERIMIENTO FORMAL · Factura ${invoice_ref}`,
    body:
      `Sr./Sra. ${customer_name},\n\n` +
      `La factura ${invoice_ref} por importe de ${total_eur} continúa ` +
      `impagada tras ${Math.abs(due_days)} días desde su vencimiento, pese a ` +
      `nuestros avisos previos.\n\n` +
      `Le requerimos formalmente el pago en un plazo máximo de 7 días ` +
      `naturales a contar desde la recepción de esta comunicación. ` +
      `Transcurrido dicho plazo sin recibir el pago, nos veremos en la ` +
      `obligación de iniciar las acciones legales oportunas para la ` +
      `reclamación de la deuda y los gastos derivados.\n\n` +
      `Un saludo cordial.`,
  }),
};

export function getReminderTemplate(input: {
  level: ReminderLevel;
  invoice_ref: string;
  customer_name: string;
  total_cents: number;
  days_overdue: number;
}): { subject: string; body: string } {
  const total_eur = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(input.total_cents / 100);
  return TEMPLATES[input.level]({
    invoice_ref: input.invoice_ref,
    customer_name: input.customer_name,
    total_eur,
    due_days: input.days_overdue,
  });
}

/**
 * Registra que se envió un recordatorio de impago al cliente. NO envía el
 * email por sí mismo — devuelve el subject+body para que el frontend abra
 * mailto: o lo procese con la integración Resend (si existe).
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
 *
 *  Default: 1º a los 15d antes/después del vencimiento, 2º a los 30d
 *  después, 3º (final) a los 60d después.
 */
export async function suggestReminderLevel(input: {
  invoice_id: string;
  days_overdue: number;
}): Promise<ReminderLevel> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data: events } = await admin
      .from("events")
      .select("payload")
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
